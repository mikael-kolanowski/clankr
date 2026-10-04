import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources";

import { readdir } from "node:fs/promises";

const weatherToolSpec = {
  type: "function",
  function: {
    name: "Weather",
    description: "Get the weather report for a location",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The location to get the weather for",
        },
      },
      required: ["location"],
    },
  },
} satisfies ChatCompletionTool;

const readToolSpec = {
	type: "function",
	function: {
		name: "Read",
		description: "Return the contents of the file at the provided path",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The location of the file to read"
				}
			},
			required: ["path"]
		}
	}
} satisfies ChatCompletionTool;

const listFilesToolSpec = {
	type: "function",
	function: {
		name: "ListFiles",
		description: "Return the list of files at the given path",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The directory whose files to list, or the current directory if ommited"
				}
			},
			required: ["path"]
		}
	}
} satisfies ChatCompletionTool;

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
		if (error instanceof Error) message = error.message
		return message;
	}
}

async function executeListFilesTool(args: { path?: string }) {
	const path = args.path ?? "."
	return (await readdir(path)).join("\n");
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
    default:
      throw new Error(`Unknown tool: ${tool_call.function.name}`);
  }
}

async function main() {
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
        tools: [weatherToolSpec, readToolSpec, listFilesToolSpec],
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
          content: result,
        });
      }
    }
  }

  rl.close();
}

main();
