export interface Config {
    model: string;
    baseURL: string;
}

export async function loadConfig(): Promise<Config> {
    const configFile = Bun.file("./config.json");
    if (!(await configFile.exists())) {
        throw new Error("Could not load the config!");
    }

    return await configFile.json();
}
