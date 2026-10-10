import { applyPatch } from "diff";
import { readdir } from "node:fs/promises";
import OpenAI from "openai";
import type { ChatCompletionMessageToolCall } from "openai/resources";

import type { Config } from "./config";
import { TOOLS } from "./tool-defs";

interface Clanker {
    config: Config;
    client: OpenAI;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
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

export async function handleAgentTurn(clanker: Clanker, prompt: string) {
    clanker.messages.push({ role: "user", content: prompt });

    while (true) {
        const response = await clanker.client.chat.completions.create({
            model: clanker.config.model,
            messages: clanker.messages,
            tools: TOOLS,
        });

        const message = response.choices[0]?.message;
        if (!message) {
            throw new Error("no message in response");
        }

        clanker.messages.push(message);

        if (!message.tool_calls?.length) {
            if (message.content) {
                console.log("\n" + message.content + "\n");
            }
            break;
        }

        for (const toolCall of message.tool_calls) {
            const result = await executeToolCall(toolCall);

            clanker.messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: result.ok ? result.result : JSON.stringify(result),
            });
        }
    }
}
