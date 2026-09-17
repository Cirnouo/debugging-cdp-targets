import process from 'node:process';
import { executeCommand } from '../application/commands.mjs';
import { parseCli } from './cli.mjs';

export function outputJson(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function main(argv) {
    const command = parseCli(argv);
    const result = await executeCommand(command);
    if (command.action === 'invoke') {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        process.exitCode = result.exitCode;
        return;
    }
    outputJson({ ok: true, ...result });
}
