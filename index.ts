#!/usr/bin/env bun
import { ChatCompletionMessageParam } from "openai/resources";
import { handleAgentTurn, newClanker } from "./src/agent";
import { loadConfig } from "./src/config";
import { file } from "bun";

function banner(host: string, modelSlug: string) {
    console.log(" ┌───────┐ ┌───┐     ┌───────┐ ┌───────┐ ┌───┐ ┌─┐ ┌───────┐");
    console.log("═│∙  ╒═╕∙│═│∙  │═════│∙  ╒═╕∙│═│∙  ╒═╕·│═│∙  │═│∙│═│∙  ╒═╕∙│");
    console.log(" │   │▓└─┘░│   │█▓▓▓ │   └─┘ │ │   │▓│ │ │   └─┘┌┘ │   └─┘┌┘");
    console.log("░│   │░┌─┐▒│   │▓┌─┐░│   ╒═╕ │░│   │▒│ │░│   ╒═╕└┐░│   ╒═╕└┐");
    console.log("▒│   │░│ │▓│   └─┘ │▒│   │░│ │▒│   │░│ │▒│   │░│ │▒│   │░│ │");
    console.log("═│∙  ╘═╛∙│═│∙     ∙│═│∙  │═│∙│═│∙  │═│∙│═│∙  │═│∙│═│∙  │═│∙│");
    console.log(" ╘═══════╛ ╘═══════╛ ╘═══╛ ╘═╛ ╘═══╛ ╘═╛ ╘═══╛ ╘═╛ ╘═══╛ ╘═╛");
    console.log("\n");
    console.log(`${modelSlug} via ${host}`);
    console.log("\n");
}

const transcriptsDir = Bun.fileURLToPath(new URL("./transcripts/", import.meta.url));

interface ProgramArguments {
    // The path to the thread to resume
    resumeThread?: string
}

function parseArgs() {
    let setup: ProgramArguments = {};
    for (const [i, arg] of process.argv.entries()) {
        switch (arg) {
            case "--resume": setup.resumeThread = process.argv[i + 1];
        }
    }
    return setup;
}

async function saveTranscript(messages: ChatCompletionMessageParam[]) {
    const logFileName = transcriptsDir
        + "transcript-"
        + new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
        + `-${process.pid}`
        + ".json";
    await Bun.write(logFileName, JSON.stringify(messages));
}

async function loadTranscript(path: string): Promise<ChatCompletionMessageParam[]> {
    console.log("resuming " + path)
    const file = Bun.file(path);
    if (!file.exists()) {
        throw Error(`the file ${path} does not exist`)
    }
    return await file.json()
}

async function main() {
    const args = parseArgs();
    const config = await loadConfig();
    banner(config.baseURL, config.model);
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not set");
    }

    const readline = require("node:readline/promises");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const initialMessages = args.resumeThread
        ? await loadTranscript(args.resumeThread)
        : undefined;

    let clanker = newClanker(config, apiKey, initialMessages);

    while (true) {
        const prompt = await rl.question("> ");

        if (prompt === "") break;

        await handleAgentTurn(clanker, prompt);
    }

    await saveTranscript(clanker.messages)

    rl.close();
}

main();
