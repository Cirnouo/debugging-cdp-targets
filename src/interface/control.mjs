import { defaultControlEndpoint, sendControlRequest } from '../adapters/control-ipc.mjs';
import { parseControlArguments } from './control-arguments.mjs';

async function main() {
    try {
        const request = parseControlArguments(process.argv.slice(2));
        const response = await sendControlRequest(defaultControlEndpoint(), request);
        process.stdout.write(`${JSON.stringify(response)}\n`);
        if (!response.ok) process.exitCode = 1;
    } catch (error) {
        const message = ['ENOENT', 'ECONNREFUSED', 'EPIPE'].includes(error.code)
            ? 'No active debugging-cdp-targets MCP connection.'
            : error.message;
        process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
        process.exitCode = 1;
    }
}

await main();
