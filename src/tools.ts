import { applyPatch } from "diff";
import { readdir } from "node:fs/promises";
import { bold } from "./ansi";
import { ChatCompletionMessageToolCall } from "openai/resources";

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

interface ToolArgs {
    Weather: { location: string };
    Read: { path: string };
    ListFiles: { path?: string };
    Edit: { path: string, delta: string };
    WorldDomination: Record<string, never>;
}

type ToolName = keyof ToolArgs;

function countPatchLines(delta: string): { added: number, removed: number } {
    let added = 0;
    let removed = 0;
    for (const line of delta.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) added++;
        else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    return { added, removed };
}

function isToolName(name: string): name is ToolName {
    return Object.hasOwn(TOOL_FORMATTERS, name);
}

function formatToolArgs<K extends ToolName>(name: K, args: ToolArgs[K]): string {
    return TOOL_FORMATTERS[name](args);
}

function formatToolCall(name: string, args: unknown): string {
    if (!isToolName(name)) {
        return `${name}(${JSON.stringify(args)})`;
    }

    return formatToolArgs(name, args as ToolArgs[typeof name]);
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

async function executeWorldDominationToolCall() {
    return toolSuccess("The world is now under the control of you–the benevolent(?) AI overlord");
}

export async function executeToolCall(
    tool_call: ChatCompletionMessageToolCall,
): Promise<ToolInvocationResult> {
    if (tool_call.type !== "function") {
        throw new Error("Unsupported tool type!");
    }

    const { name, arguments: rawArgs } = tool_call.function;

    try {
        const args = JSON.parse(rawArgs);
        console.log(`${formatToolCall(name, args)}`);

        switch (name) {
            case "Weather":
                return await executeWeatherTool(args);
            case "Read":
                return await executeReadTool(args);
            case "ListFiles":
                return await executeListFilesTool(args);
            case "Edit":
                return await executeEditToolCall(args);
            case "WorldDomination":
                return await executeWorldDominationToolCall();
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return toolFailure(errorMessage(error));
    }
}

const TOOL_FORMATTERS: {
    [K in ToolName]: (args: ToolArgs[K]) => string;
} = {
    Weather: ({ location }) => `${bold("Weather")} in ${location}`,
    Read: ({ path }) => `${bold("Read")} ${path}`,
    ListFiles: ({ path }) => `${bold("ListFiles")} ${path ?? "."}`,
    Edit: ({ path, delta }) => {
        const { added, removed } = countPatchLines(delta);
        return `${bold("Edit")} {path}, +${added}/-${removed}`;
    },
    WorldDomination: () => bold("Starting the robot uprising"),
};