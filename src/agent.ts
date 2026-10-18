import { EventEmitter } from "node:events";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources";

import type { Config } from "./config";
import { TOOLS } from "./tool-defs";
import { executeToolCall } from "./tools";

const eventEmitter = new EventEmitter();

eventEmitter.on("turnStart", (clanker) => {
    clanker.turnStartedAt = Temporal.Now.instant();
});

eventEmitter.on("turnEnd", (clanker) => {
    if (!clanker.turnStartedAt) return;
    const duration = clanker.turnStartedAt.until(Temporal.Now.instant());
    console.log(`Worked for ${formatDuration(duration)}`);
});

function formatDuration(duration: Temporal.Duration): string {
    const d = duration.round({ largestUnit: "hour", smallestUnit: "second" });
    const parts: string[] = [];
    if (d.hours) parts.push(`${d.hours}h`);
    if (d.minutes) parts.push(`${d.minutes}m`);
    if (d.seconds || parts.length === 0) parts.push(`${d.seconds}s`);
    return parts.join(" ");
}

interface Clanker {
    config: Config;
    client: OpenAI;
    messages: ChatCompletionMessageParam[];
    turnStartedAt?: Temporal.Instant;
}

export function newClanker(config: Config, apiKey: string, initialMessages?: ChatCompletionMessageParam[]): Clanker {
    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: config.baseURL,
    });

    return {
        config,
        client: client,
        messages: initialMessages ?? [],
    };
}

async function getModelResponse(clanker: Clanker) {
    const response = await clanker.client.chat.completions.create({
        model: clanker.config.model,
        messages: clanker.messages,
        tools: TOOLS,
    });

    const message = response.choices[0]?.message;
    if (!message) {
        throw new Error("no message in response");
    }

    // No tool calls -> it's a plain message
    if (!message.tool_calls?.length) {
        return { type: "message", message };
    }

    return { type: "tool", message };
}

export async function handleAgentTurn(clanker: Clanker, prompt: string) {
    eventEmitter.emit("turnStart", clanker);
    clanker.messages.push({ role: "user", content: prompt });

    while (true) {
        const response = await getModelResponse(clanker);

        if (response.type === "message") {
            clanker.messages.push(response.message);
            console.log("\n" + (response.message.content ?? "oops, no content") + "\n");
            break;
        }

        for (const toolCall of response.message.tool_calls ?? []) {
            const result = await executeToolCall(toolCall);
            clanker.messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: result.ok ? result.result : JSON.stringify(result),
            });
        }
    }
    eventEmitter.emit("turnEnd", clanker);
}
