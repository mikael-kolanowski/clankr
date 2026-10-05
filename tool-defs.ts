import type { ChatCompletionTool } from "openai/resources";

export const weatherToolSpec = {
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

export const readToolSpec = {
    type: "function",
    function: {
        name: "Read",
        description: "Return the contents of the file at the provided path",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The location of the file to read",
                },
            },
            required: ["path"],
        },
    },
} satisfies ChatCompletionTool;

export const listFilesToolSpec = {
    type: "function",
    function: {
        name: "ListFiles",
        description: "Return the list of files at the given path",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "The directory whose files to list, or the current directory if ommited",
                },
            },
            required: ["path"],
        },
    },
} satisfies ChatCompletionTool;

export const editToolSpec = {
    type: "function",
    function: {
        name: "Edit",
        description: "Apply a patch delta to a file",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The file to edit",
                },
                delta: {
                    type: "string",
                    description:
                        "Unified diff containing only the changes to apply to the file. " +
                        "Do not include unchanged file contents, Markdown fences, or explanations.",
                },
            },
            required: ["path", "delta"],
        },
    },
} satisfies ChatCompletionTool;

export const TOOLS = [
    weatherToolSpec,
    readToolSpec,
    listFilesToolSpec,
    editToolSpec,
];
