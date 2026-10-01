import { defaultControlEndpoint, sendControlRequest } from '../adapters/control-ipc.ts';
import { errorCode, errorMessage } from '../shared/errors.ts';
import { parseControlArguments } from './control-arguments.ts';

async function main() {
    try {
        const request = parseControlArguments(process.argv.slice(2));
        const response = await sendControlRequest(defaultControlEndpoint(), request);
        process.stdout.write(`${JSON.stringify(response)}\n`);
        if (!response.ok) process.exitCode = 1;
    } catch (error) {
        const message = ['ENOENT', 'ECONNREFUSED', 'EPIPE'].includes(errorCode(error) ?? '')
            ? 'No active debugging-cdp-targets MCP connection.'
            : errorMessage(error);
        process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
        process.exitCode = 1;
    }
}

await main();
