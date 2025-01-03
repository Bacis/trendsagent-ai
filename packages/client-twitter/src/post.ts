import { Tweet } from "agent-twitter-client";
import {
    composeContext,
    generateText,
    getEmbeddingZeroVector,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    parseBooleanFromText,
    parseJSONObjectFromText,
} from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { ClientBase } from "./base.ts";

const twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a 1-3 sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.
Your response should not contain any questions. Brief, concise statements only. The total character count MUST be less than 280. No emojis. Use \\n\\n (double spaces) between statements.`;

const MAX_TWEET_LENGTH = 280;

/**
 * Truncate text to fit within the Twitter character limit, ensuring it ends at a complete sentence.
 */
function truncateToCompleteSentence(text: string): string {
    if (text.length <= MAX_TWEET_LENGTH) {
        return text;
    }

    // Attempt to truncate at the last period within the limit
    const truncatedAtPeriod = text.slice(
        0,
        text.lastIndexOf(".", MAX_TWEET_LENGTH) + 1
    );
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    // If no period is found, truncate to the nearest whitespace
    const truncatedAtSpace = text.slice(
        0,
        text.lastIndexOf(" ", MAX_TWEET_LENGTH)
    );
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    // Fallback: Hard truncate and add ellipsis
    return text.slice(0, MAX_TWEET_LENGTH - 3).trim() + "...";
}

export class TwitterPostClient {
    client: ClientBase;
    runtime: IAgentRuntime;

    async start(postImmediately: boolean = false) {
        console.log("TwitterPostClient start");
        if (!this.client.profile) {
            await this.client.init();
        }

        const generateNewTweetLoop = async () => {
            const lastPost = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.runtime.getSetting("TWITTER_USERNAME") +
                    "/lastPost"
            );

            const lastPostTimestamp = lastPost?.timestamp ?? 0;
            const minMinutes =
                parseInt(this.runtime.getSetting("POST_INTERVAL_MIN")) || 90;
            const maxMinutes =
                parseInt(this.runtime.getSetting("POST_INTERVAL_MAX")) || 180;
            const randomMinutes =
                Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) +
                minMinutes;
            const delay = randomMinutes * 60 * 1000;

            if (Date.now() > lastPostTimestamp + delay) {
                // await this.generateNewTweet();
                await this.generateNewTweetFromMemory();
            }

            setTimeout(() => {
                generateNewTweetLoop(); // Set up next iteration
            }, delay);

            elizaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`);
        };
        if (
            this.runtime.getSetting("POST_IMMEDIATELY") != null &&
            this.runtime.getSetting("POST_IMMEDIATELY") != ""
        ) {
            postImmediately = parseBooleanFromText(
                this.runtime.getSetting("POST_IMMEDIATELY")
            );
        }
        if (postImmediately) {
            // this.generateNewTweet();
            this.generateNewTweetFromMemory();
        }

        generateNewTweetLoop();
    }

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
    }

    private async generateNewTweetFromMemory() {
        elizaLogger.log("Generating new tweet from memory");

        try {
            const roomId = stringToUuid(
                "perplexity_room-" + this.runtime.agentId
            );

            // Get recent memories from the perplexity room
            const memories = await this.runtime.messageManager.getMemories({
                roomId,
            });

            if (!memories || memories.length === 0) {
                elizaLogger.warn(
                    "No memories found to generate tweet from " + roomId
                );
                return;
            }

            // Get already posted memories from cache
            const postedMemories =
                (await this.runtime.cacheManager.get<string[]>(
                    `twitter/${this.client.profile.username}/postedMemories`
                )) || [];

            // Process only unposted memories
            for (const memory of memories) {
                // Skip if this memory was already posted
                if (postedMemories.includes(memory.id)) {
                    continue;
                }

                // Sanitize memory content by removing markdown formatting
                const sanitizedText = memory.content.text
                    .replace(/\*\*/g, "") // Remove bold
                    .replace(/\*/g, "") // Remove italic
                    .replace(/\[(\d+)\]/g, "") // Remove reference numbers like [1]
                    .replace(/#{1,6}\s/g, "") // Remove heading markers
                    .replace(/\[(.*?)\]\((.*?)\)/g, "$1") // Convert links to just text
                    .replace(/`/g, "") // Remove code formatting
                    .replace(/>/g, "") // Remove blockquotes
                    .replace(/\n\s*\n/g, "\n") // Collapse multiple newlines
                    .trim();

                // Update the memory content with sanitized text
                memory.content.text = sanitizedText;

                const testActionTemplate = `You are a twitter shitposter, an expert at sharing viral trends.
                Your task is to rewrite the following content into a multi-part tweet thread.

                IMPORTANT REQUIREMENTS:
                - ALWAYS generate a FULL with at least 7-9 tweet parts
                - Each tweet part must be under 280 and more than 250 characters
                - Last tweet part can be under 250 characters
                - Never use emojis or emoticons of any kind

                Following content:
                {{actionResponse}}

                Output Format (JSON):
                \`\`\`json
                {
                    "thread": [
                        "First tweet part (max 280 chars)",
                        "Second tweet part (max 280 chars)",
                        "Third tweet part (max 280 chars)",
                        "Fourth tweet part (max 280 chars, optional)",
                        "Fourth tweet part (max 280 chars, optional)",
                        "Fifth tweet part (max 280 chars, optional)",
                        "Sixth tweet part (max 280 chars, optional)",
                        "Seventh tweet part (max 280 chars, optional)",
                        "Eighth tweet part (max 280 chars, optional)",
                        "Ninth tweet part (max 280 chars, optional)"
                    ]
                }
                \`\`\`

                Example of good output:
                \`\`\`json
                {
                    "thread": [
                        "Breaking: CHILLGUY token explodes 482,260% in 2 months. Young traders on TikTok are rewriting crypto rules.",
                        "Market cap soars to $374M. Traditional finance can't ignore the memecoin revolution happening on social platforms.",
                        "Data reveals: 68% of Gen Z investors discovered CHILLGUY through viral TikTok content. Social media is the new stock market.",
                        "Trend alert: Memecoins aren't just jokes anymore. They're a serious investment strategy challenging Wall Street's old guard.",
                        "CHILLGUY's success shows: Memecoins are more than just jokes. They're a new way to invest in crypto.",
                        "CHILLGUY's rise: Memecoins are changing the game for young investors.",
                        "CHILLGUY's impact: Memecoins are shaking up Wall Street's old guard.",
                        "CHILLGUY's future: Memecoins are the future of crypto investing."
                    ]
                }
                \`\`\``;

                const state = await this.runtime.composeState(
                    {
                        userId: this.runtime.agentId,
                        roomId,
                        agentId: this.runtime.agentId,
                        content: {
                            text: memory.content.text,
                        },
                    },
                    {
                        twitterUserName: this.client.profile.username,
                        actionResponse: memory.content.text,
                    }
                );

                const context = composeContext({
                    state,
                    template: testActionTemplate,
                });

                const threadResponse = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });

                // Parse JSON thread response
                const parsedThread = parseJSONObjectFromText(threadResponse);
                const tweetParts = parsedThread?.thread || [threadResponse];

                // Additional emoji removal pass
                const sanitizedTweetParts = tweetParts.map((part) =>
                    part.replace(
                        /[\u{1F300}-\u{1F9FF}]|[\u{2700}-\u{27BF}]|[\u{2600}-\u{26FF}]/gu,
                        ""
                    )
                );

                elizaLogger.debug(
                    "generate post prompt from memory:\n" + context
                );

                if (this.runtime.getSetting("TWITTER_DRY_RUN") === "true") {
                    elizaLogger.info(
                        `Dry run: would have posted tweet thread from memory: ${sanitizedTweetParts.join("\n---\n")}`
                    );
                    continue;
                }

                try {
                    elizaLogger.log(
                        `Posting new tweet thread from memory with ${sanitizedTweetParts.length} parts`
                    );

                    let previousTweetId: string | undefined;
                    let firstTweet: Tweet | undefined;

                    for (const content of sanitizedTweetParts) {
                        const result = await this.client.requestQueue.add(
                            async () =>
                                await this.client.twitterClient.sendTweet(
                                    content,
                                    previousTweetId
                                )
                        );
                        const body = await result.json();
                        if (!body?.data?.create_tweet?.tweet_results?.result) {
                            console.error(
                                "Error sending tweet; Bad response:",
                                body
                            );
                            continue;
                        }
                        const tweetResult =
                            body.data.create_tweet.tweet_results.result;

                        const tweet = {
                            id: tweetResult.rest_id,
                            name: this.client.profile.screenName,
                            username: this.client.profile.username,
                            text: tweetResult.legacy.full_text,
                            conversationId:
                                tweetResult.legacy.conversation_id_str,
                            createdAt: tweetResult.legacy.created_at,
                            timestamp: new Date(
                                tweetResult.legacy.created_at
                            ).getTime(),
                            userId: this.client.profile.id,
                            inReplyToStatusId:
                                tweetResult.legacy.in_reply_to_status_id_str,
                            permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                            hashtags: [],
                            mentions: [],
                            photos: [],
                            thread: [],
                            urls: [],
                            videos: [],
                        } as Tweet;

                        if (!firstTweet) {
                            firstTweet = tweet;
                            await this.runtime.cacheManager.set(
                                `twitter/${this.client.profile.username}/lastPost`,
                                {
                                    id: tweet.id,
                                    timestamp: Date.now(),
                                }
                            );
                        }

                        await this.client.cacheTweet(tweet);
                        previousTweetId = tweet.id;
                    }

                    if (firstTweet) {
                        elizaLogger.log(
                            `Tweet thread posted from memory, starting at:\n ${firstTweet.permanentUrl}`
                        );

                        // Mark this memory as posted
                        postedMemories.push(memory.id);
                        await this.runtime.cacheManager.set(
                            `twitter/${this.client.profile.username}/postedMemories`,
                            postedMemories
                        );
                    }
                } catch (error) {
                    elizaLogger.error(
                        "Error sending tweet thread from memory:",
                        error
                    );
                }
            }
        } catch (error) {
            elizaLogger.error("Error generating new tweet from memory:", error);
        }
    }

    private async generateNewTweet() {
        elizaLogger.log("Generating new tweet @@@@@@@@@@@@");

        try {
            const roomId = stringToUuid(
                "twitter_generate_room-" + this.client.profile.username
            );
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.client.profile.username,
                this.runtime.character.name,
                "twitter"
            );

            const topics = this.runtime.character.topics.join(", ");

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: roomId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: topics,
                    },
                },
                {
                    twitterUserName: this.client.profile.username,
                }
            );

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterPostTemplate ||
                    twitterPostTemplate,
            });

            elizaLogger.debug("generate post prompt:\n" + context);
            elizaLogger.log("generate post prompt:\n" + context);
            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // Replace \n with proper line breaks and trim excess spaces
            const formattedTweet = newTweetContent
                .replaceAll(/\\n/g, "\n")
                .trim();

            // Use the helper function to truncate to complete sentence
            const content = truncateToCompleteSentence(formattedTweet);

            if (this.runtime.getSetting("TWITTER_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have posted tweet: ${content}`
                );
                return;
            }

            try {
                elizaLogger.log(`Posting new tweet:\n ${content}`);

                const result = await this.client.requestQueue.add(
                    async () =>
                        await this.client.twitterClient.sendTweet(content)
                );
                const body = await result.json();
                if (!body?.data?.create_tweet?.tweet_results?.result) {
                    console.error("Error sending tweet; Bad response:", body);
                    return;
                }
                const tweetResult = body.data.create_tweet.tweet_results.result;

                const tweet = {
                    id: tweetResult.rest_id,
                    name: this.client.profile.screenName,
                    username: this.client.profile.username,
                    text: tweetResult.legacy.full_text,
                    conversationId: tweetResult.legacy.conversation_id_str,
                    createdAt: tweetResult.legacy.created_at,
                    timestamp: new Date(
                        tweetResult.legacy.created_at
                    ).getTime(),
                    userId: this.client.profile.id,
                    inReplyToStatusId:
                        tweetResult.legacy.in_reply_to_status_id_str,
                    permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                    hashtags: [],
                    mentions: [],
                    photos: [],
                    thread: [],
                    urls: [],
                    videos: [],
                } as Tweet;

                await this.runtime.cacheManager.set(
                    `twitter/${this.client.profile.username}/lastPost`,
                    {
                        id: tweet.id,
                        timestamp: Date.now(),
                    }
                );

                await this.client.cacheTweet(tweet);

                elizaLogger.log(`Tweet posted:\n ${tweet.permanentUrl}`);

                await this.runtime.ensureRoomExists(roomId);
                await this.runtime.ensureParticipantInRoom(
                    this.runtime.agentId,
                    roomId
                );

                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: newTweetContent.trim(),
                        url: tweet.permanentUrl,
                        source: "twitter",
                    },
                    roomId,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: tweet.timestamp,
                });
            } catch (error) {
                elizaLogger.error("Error sending tweet:", error);
            }
        } catch (error) {
            elizaLogger.error("Error generating new tweet:", error);
        }
    }
}
