#!/usr/bin/env bun
import { handleAgentTurn, newClanker } from "./src/agent";
import { loadConfig } from "./src/config";

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

async function main() {
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

    let clanker = newClanker(config, apiKey);

    while (true) {
        const prompt = await rl.question("> ");

        if (prompt === "") break;

        await handleAgentTurn(clanker, prompt);
    }

    const transcriptsDir = Bun.fileURLToPath(new URL("./transcripts/", import.meta.url));
    const logFileName = transcriptsDir
        + "transcript-"
        + new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
        + `-${process.pid}`
        + ".json";
    await Bun.write(logFileName, JSON.stringify(clanker.messages));

    rl.close();
}

main();
