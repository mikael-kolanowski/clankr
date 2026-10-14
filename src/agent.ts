import { applyPatch } from "diff";
import { EventEmitter } from "node:events";
import { readdir } from "node:fs/promises";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources";

import type { Config } from "./config";
import { TOOLS } from "./tool-defs";

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

export function newClanker(config: Config, apiKey: string): Clanker {
    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: config.baseURL,
    });

    return {
        config,
        client: client,
        messages: [],
    };
}

type ToolInvocationResult = { ok: true, result: string } | { ok: false, error: string };

function toolSuccess(result?: string): ToolInvocationResult {
    const res = result ? result : "";
    return { ok: true, result: res };
}

function toolFailure(error: string): ToolInvocationResult {
    return { ok: false, error: error };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatToolCall(tool_call: ChatCompletionMessageToolCall) {
    if (tool_call.type !== "function") {
        throw new Error("Unsupported tool type!");
    }
    return `${tool_call.function.name}(${tool_call.function.arguments})`;
}

async function executeWeatherTool(args: {
    location: string,
}): Promise<ToolInvocationResult> {
    try {
        const response = await fetch(
            `https://wttr.in/${encodeURIComponent(args.location)}?format=3`,
        );

        if (!response.ok) {
            return toolFailure(`wttr.in returned ${response.status}`);
        }

        return toolSuccess(await response.text());
    } catch (error) {
        return toolFailure(errorMessage(error));
    }
}

async function executeReadTool(args: {
    path: string,
}): Promise<ToolInvocationResult> {
    try {
        return toolSuccess(await Bun.file(args.path).text());
    } catch (error) {
        return toolFailure(errorMessage(error));
    }
}

async function executeListFilesTool(args: { path?: string }) {
    const path = args.path ?? ".";
    try {
        return toolSuccess((await readdir(path)).join("\n"));
    } catch (error) {
        let message = "Unknown error";
        if (error instanceof Error) message = error.message;
        return toolFailure(message);
    }
}

async function executeEditToolCall(args: {
    path: string,
    delta: string,
}): Promise<ToolInvocationResult> {
    const { path, delta } = args;

    console.log(`Applying patch ${delta} to ${path}`);
    const file = Bun.file(path);
    const exists = await file.exists();

    const source = exists ? await file.text() : "";
    const result = applyPatch(source, delta);

    if (result === false) {
        return toolFailure("Patch could not be applied");
    }

    await Bun.write(path, result);
    return toolSuccess("Patch applied");
}

async function executeToolCall(
    tool_call: ChatCompletionMessageToolCall,
): Promise<ToolInvocationResult> {
    if (tool_call.type !== "function") {
        throw new Error("Unsupported tool type!");
    }
    const args = JSON.parse(tool_call.function.arguments);
    console.log(`   ${formatToolCall(tool_call)}`);

    try {
        switch (tool_call.function.name) {
            case "Weather":
                return await executeWeatherTool(args);
            case "Read":
                return await executeReadTool(args);
            case "ListFiles":
                return await executeListFilesTool(args);
            case "Edit":
                return await executeEditToolCall(args);
            default:
                throw new Error(`Unknown tool: ${tool_call.function.name}`);
        }
    } catch (error) {
        return toolFailure(errorMessage(error));
    }
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
			clanker.messages.push(response.message)
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
