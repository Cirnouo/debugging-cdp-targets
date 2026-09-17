import process from "node:process";

export async function closeServer(server) {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
}

export function getRuntimePlatform() {
    return process.platform;
}

export function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
