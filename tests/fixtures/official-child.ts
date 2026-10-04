import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { isRecord } from '../../src/shared/errors.ts';

const directory = process.argv[2];
const mode = process.argv[3];
if (!directory || !mode) throw new Error('Official child fixture requires a directory and mode.');

function mark(name: string) {
    if (!directory) throw new Error('Missing fixture directory.');
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ pid: process.pid, time: Date.now() }));
}

function send(message: Record<string, unknown>) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

mark('started');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => mark('term'));
process.stdin.once('end', () => mark('eof'));
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
    const message: unknown = JSON.parse(line);
    if (!isRecord(message)) throw new Error('Expected JSON-RPC object.');
    appendFileSync(path.join(directory, 'messages.jsonl'), `${line}\n`);
    if (message.method === 'initialize') {
        mark('initialize');
        if (mode === 'initialize') return;
        if (!isRecord(message.params)) throw new Error('Expected initialize params.');
        send({
            id: message.id,
            result: {
                protocolVersion: mode === 'invalid-initialize' ? '1900-01-01' : message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'official-child-fixture', version: '1' },
            },
        });
    } else if (message.method === 'tools/list') {
        mark('listing');
        if (mode === 'listing') return;
        send({
            id: message.id,
            result: { tools: [{ name: 'hold', inputSchema: { type: 'object', properties: {} } }] },
        });
    } else if (message.method === 'tools/call') {
        if (!isRecord(message.params) || !isRecord(message.params.arguments)) {
            throw new Error('Expected tool arguments.');
        }
        if (message.params.arguments.pid === true) {
            send({ id: message.id, result: { content: [], structuredContent: { pid: process.pid } } });
            return;
        }
        if (message.params.arguments.exitWithHeldPipes === true) {
            const holder = spawn(
                process.execPath,
                ['-e', "process.send('ready'); setTimeout(() => process.exit(0), 1800)"],
                {
                    shell: false,
                    windowsHide: true,
                    stdio: ['ignore', process.stdout, process.stderr, 'ipc'],
                },
            );
            holder.once('message', () => process.exit(0));
            return;
        }
        const meta = message.params._meta;
        if (isRecord(meta) && meta.progressToken !== undefined) {
            send({
                method: 'notifications/progress',
                params: { progressToken: meta.progressToken, progress: 1 },
            });
        }
        mark('calling');
        if (message.params.arguments.disconnect === true) {
            process.stdout.destroy();
            process.stderr.destroy();
            process.stdin.destroy();
            mark('disconnected');
        }
    }
});
