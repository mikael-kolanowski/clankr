import OpenAI from "openai";
import type {
  ChatCompletionMessageToolCall,
} from "openai/resources";

import { TOOLS } from "./tool-defs.ts";

import { readdir } from "node:fs/promises";
import { applyPatch } from "diff";

function banner() {
	console.log(" ┌───────┐ ┌───┐     ┌───────┐ ┌───────┐ ┌───┐ ┌─┐ ┌───────┐");
	console.log("═│∙  ╒═╕∙│═│∙  │═════│∙  ╒═╕∙│═│∙  ╒═╕·│═│∙  │═│∙│═│∙  ╒═╕∙│");
	console.log(" │   │▓└─┘░│   │█▓▓▓ │   └─┘ │ │   │▓│ │ │   └─┘┌┘ │   └─┘┌┘");
	console.log("░│   │░┌─┐▒│   │▓┌─┐░│   ╒═╕ │░│   │▒│ │░│   ╒═╕└┐░│   ╒═╕└┐");
	console.log("▒│   │░│ │▓│   └─┘ │▒│   │░│ │▒│   │░│ │▒│   │░│ │▒│   │░│ │");
	console.log("═│∙  ╘═╛∙│═│∙     ∙│═│∙  │═│∙│═│∙  │═│∙│═│∙  │═│∙│═│∙  │═│∙│");
	console.log(" ╘═══════╛ ╘═══════╛ ╘═══╛ ╘═╛ ╘═══╛ ╘═╛ ╘═══╛ ╘═╛ ╘═══╛ ╘═╛");
	console.log("\n");
}

type ToolInvocationResult =
	| { ok: true, result: string }
	| { ok: false, error: string };

function toolSuccess(result?: string): ToolInvocationResult {
	const res = result ? result : "";
	return { ok: true, result: res };
}

function toolFailure(error: string): ToolInvocationResult {
	return { ok: false, error: error };
}

function formatToolCall(tool_call: ChatCompletionMessageToolCall) {
  if (tool_call.type !== "function") {
    throw new Error("Unsupported tool type!");
  }
  return `${tool_call.function.name}(${tool_call.function.arguments})`;
}

async function executeWeatherTool(args: { location: string }) {
  const response = await fetch(
    `https://wttr.in/${encodeURIComponent(args.location)}?format=3`,
  );

  if (!response.ok) {
    throw new Error(`wttr.in returned ${response.status}`);
  }

  return await response.text();
}

async function executeReadTool(args: { path: string }) {
	const file = Bun.file(args.path);
	try {
		return await file.text();
	} catch (error) {
		let message = "Unknown error";
		if (error instanceof Error) message = error.message;
		return message;
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

async function executeEditToolCall(args: { path: string, delta: string }) {
	const { path, delta } = args;

	console.log(`Applying patch ${delta} to ${path}`)
	const file = Bun.file(path);
	const exists = await file.exists();

	const source = exists ? await file.text() : "";
	const result = applyPatch(source, delta);

	if (result === false) {
		return JSON.stringify(toolFailure("Patch could not be applied"));
	}
	
	await Bun.write(path, result);
	return JSON.stringify(toolSuccess());
}

async function executeToolCall(tool_call: ChatCompletionMessageToolCall) {
  if (tool_call.type !== "function") {
    throw new Error("Unsupported tool type!");
  }
  const args = JSON.parse(tool_call.function.arguments);
  console.log(`   ${formatToolCall(tool_call)}`);

  switch (tool_call.function.name) {
    case "Weather":
      return executeWeatherTool(args);
	case "Read":
		return executeReadTool(args);
	case "ListFiles":
		return executeListFilesTool(args);
	case "Edit":
		return executeEditToolCall(args);
    default:
      throw new Error(`Unknown tool: ${tool_call.function.name}`);
  }
}

async function main() {
	banner();
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  const readline = require("node:readline/promises");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  while (true) {
    const line = await rl.question("> ");

    if (line === "") break;

    messages.push({ role: "user", content: line });

    while (true) {
      const response = await client.chat.completions.create({
        model: "z-ai/glm-5.3-flash",
        messages,
        tools: TOOLS,
      });

      const message = response.choices[0]?.message;
      if (!message) {
        throw new Error("no message in response");
      }

      messages.push(message);

      if (!message.tool_calls?.length) {
        if (message.content) {
          console.log("\n" + message.content + "\n");
        }
        break;
      }

      for (const toolCall of message.tool_calls) {
        const result = await executeToolCall(toolCall);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content:
            typeof result === "string"
              ? result
              : result.ok
                ? result.result
                : JSON.stringify(result),
        });
      }
    }
  }

  rl.close();
}

main();
