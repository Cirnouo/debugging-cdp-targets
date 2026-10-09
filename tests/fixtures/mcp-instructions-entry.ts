import { appendFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createMcpEntryServer } from '../../src/adapters/mcp-entry-server.ts';

const evidence = process.env.DCT_INSTRUCTIONS_EVIDENCE;
if (!evidence) throw new Error('An explicit temporary evidence path is required.');
const evidencePath = evidence;
function record(value: unknown) {
    appendFileSync(evidencePath, `${JSON.stringify(value)}\n`, 'utf8');
}
class ObservedTransport extends StdioServerTransport {
    override async start() {
        await super.start();
        const receive = this.onmessage;
        this.onmessage = (message) => {
            if ('method' in message) {
                record({ direction: 'request', method: message.method });
                if (message.method === 'tools/call') {
                    process.exitCode = 1;
                    throw new Error('Instruction consumption must never execute MCP tools.');
                }
            }
            receive?.(message);
        };
    }
    override async send(message: Parameters<StdioServerTransport['send']>[0]) {
        if ('result' in message) record({ direction: 'response', result: message.result });
        await super.send(message);
    }
}
const entry = createMcpEntryServer({
    tools: [],
    status: () => ({ entryId: 'instructions-fixture', connections: [] }),
    invoke: async () => {
        throw new Error('Official tool invocation is unavailable.');
    },
    transport: new ObservedTransport(),
});
process.stdin.once('end', () => {
    void entry.close();
});
await entry.connect();
await entry.closed;
