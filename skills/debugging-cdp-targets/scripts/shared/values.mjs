import path from 'node:path';

export async function closeServer(server) {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
}

export function isIntegerInRange(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function normalizePath(value) {
    return path.win32.normalize(value).toLocaleLowerCase('en-US');
}

export function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
