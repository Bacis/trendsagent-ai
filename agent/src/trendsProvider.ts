import { IAgentRuntime, Memory, Provider } from "@ai16z/eliza";
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

const trendsProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory) => {
        try {
            console.log("trendsProvider triggered with message:", message);
            const question = message.content.text;
            const response = await client.chat.completions.create({
                model: "perplexity/llama-3.1-sonar-huge-128k-online",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful AI assistant.",
                    },
                    { role: "user", content: question },
                ],
            });

            console.log(
                "response.choices[0].message.content",
                response.choices[0].message.content
            );
            return response.choices[0].message.content;
        } catch (error) {
            console.error("Error:", error);
            throw error;
        }
    },
};

export { trendsProvider };
