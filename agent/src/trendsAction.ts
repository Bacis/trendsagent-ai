import {
    Action,
    elizaLogger,
    IAgentRuntime,
    Memory,
    stringToUuid,
} from "@ai16z/eliza";
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

const analyticsPrompt = `
Core Analysis Requirements:

Engagement Metrics:
- Total mentions/posts volume
- Average daily post frequency
- Peak posting times/dates
- Engagement rate (likes + shares + comments / total posts)
- Top performing posts (minimum 3)

Content Analysis:
- Top 5 most used related hashtags
- Common phrases/keywords (minimum 10)
- Content type breakdown (text, image, video %)
- Key themes and narratives

Growth Patterns:
- Day-over-day growth rate
- Viral coefficient (if applicable)
- Content spread patterns
- Platform crossover rate

Please provide all numerical data with specific percentages, counts, or ratios. Include benchmarks against industry averages where possible.
`;

export const analyzeTrendsAction: Action = {
    name: "ANALYZE_TRENDS",
    similes: ["ANALYZE_SOCIAL_MEDIA"],
    description:
        "Analyze data from social media platforms to find the biggest trends",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // Check if the message contains specific keywords
        return true;
    },
    handler: async (runtime: IAgentRuntime, message: Memory) => {
        try {
            const question = message.content.text;
            const response = await client.chat.completions.create({
                model: "perplexity/llama-3.1-sonar-huge-128k-online",
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a helpful AI assistant that helps to analyze trends and prepare answers in plain text for twitter posts or threads!",
                    },
                    {
                        role: "user",
                        content: `Please analyze the following social media trend: ${question}`,
                    },
                ],
            });

            const roomId = stringToUuid("perplexity_room-" + runtime.agentId);
            const responseText =
                response.choices[0].message.content?.trim() || "";

            const newMemory: Memory = {
                content: {
                    question,
                    text: responseText,
                },
                userId: runtime.agentId,
                agentId: runtime.agentId,
                roomId,
            };

            await runtime.messageManager.createMemory(newMemory, true);

            elizaLogger.log("ANALYZE_TRENDS saving memory...", newMemory);

            return responseText;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Analyze what are the biggest memecoin trends in November on TikTok?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Fetching the latest trends...",
                    action: "ANALYZE_TRENDS",
                },
            },
        ],
    ],
};
