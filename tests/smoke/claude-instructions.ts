import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureAppInitialization } from './app-http.ts';
import { type ClaudeBlock, claudeSse, claudeToolResult, record } from './claude-host.ts';
import { claudeCli, claudeHost, sandbox } from './claude-process.ts';
import { claudeInstructionLocations, initializationEvidence, testedSource } from './instructions-evidence.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executable =
    process.argv[2] ?? (process.platform === 'win32' ? path.join(os.homedir(), '.local/bin/claude.exe') : 'claude');
const { temporary } = await sandbox(root, 'instructions');
const exercise = process.argv.includes('--exercise-lifecycle');
let bearer: string | undefined;
let registrationId: string | undefined;
const lifecycleCalls: string[] = [];
console.log(`Retained evidence: ${temporary}`);
const fixtureEvidence = path.join(temporary, 'app-http-initialize.json');
await captureAppInitialization(fixtureEvidence);
const prompt = exercise
    ? 'Register once with the local inspection gateway and read only that registration status; start no target.'
    : 'Discover the available inspection gateway, then finish without calling any tools.';
let failure: unknown;
let count = 0;
let locations: string[] = [];
const model = createServer(async (request, response) => {
    try {
        if (request.method === 'HEAD' && request.url === '/api/hello') {
            response.end();
            return;
        }
        if (request.url?.startsWith('/v1/messages/count_tokens')) {
            response.end('{"input_tokens":10}');
            return;
        }
        assert.equal(request.method, 'POST');
        assert.ok(request.url === '/v1/messages' || request.url === '/v1/messages?beta=true');
        let raw = '';
        for await (const chunk of request) raw += chunk;
        count++;
        if (count === 1) await writeFile(path.join(temporary, `request-${count}.json`), raw);
        assert.ok(count <= (exercise ? 3 : 1));
        const value: unknown = JSON.parse(raw);
        assert.ok(
            record(value) &&
                typeof value.model === 'string' &&
                Array.isArray(value.tools) &&
                Array.isArray(value.messages),
        );
        const production = await initializationEvidence(fixtureEvidence);
        if (!exercise)
            locations = claudeInstructionLocations(value, production.instructions, prompt, production.toolNames);
        let block: ClaudeBlock = { type: 'text', text: 'Instruction consumption fixture completed.' };
        if (exercise) {
            if (count === 2) {
                const registered = claudeToolResult(value.messages.filter(record), 'register-once');
                assert.ok(
                    typeof registered.registrationBearer === 'string' && typeof registered.registrationId === 'string',
                );
                bearer = registered.registrationBearer;
                registrationId = registered.registrationId;
            }
            if (count === 3) {
                const status = claudeToolResult(value.messages.filter(record), 'owned-status');
                assert.deepEqual(status.connections, []);
                assert.equal(JSON.stringify(status).includes(bearer ?? 'missing-bearer'), false);
            } else {
                const name = count === 1 ? 'dct_registration_register' : 'dct_connection_status';
                const tool = value.tools
                    .filter(record)
                    .find((tool) => typeof tool.name === 'string' && tool.name.endsWith(`__${name}`));
                assert.ok(tool && typeof tool.name === 'string');
                lifecycleCalls.push(name);
                block = {
                    type: 'tool_use',
                    id: count === 1 ? 'register-once' : 'owned-status',
                    name: tool.name,
                    input: count === 1 ? {} : { registrationBearer: bearer },
                };
            }
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(claudeSse(value.model, count, block));
    } catch (error) {
        const first = failure === undefined;
        failure ??= error;
        if (first) await writeFile(path.join(temporary, 'provider-failure.txt'), String(error));
        response.writeHead(500);
        response.end(String(error));
    }
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
const address = model.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}`;
try {
    const marketplace = path.join(temporary, 'marketplace');
    const plugin = path.join(marketplace, 'plugins/claude-code/debugging-cdp-targets');
    await mkdir(path.join(marketplace, '.claude-plugin'), { recursive: true });
    await cp(
        path.join(root, '.claude-plugin/marketplace.json'),
        path.join(marketplace, '.claude-plugin/marketplace.json'),
    );
    await mkdir(plugin, { recursive: true });
    for (const name of ['.claude-plugin', 'skills', 'assets', '.mcp.json', 'LICENSE', 'README.md'])
        await cp(path.join(root, 'plugins/claude-code/debugging-cdp-targets', name), path.join(plugin, name), {
            recursive: true,
        });

    await claudeCli(executable, ['plugin', 'marketplace', 'add', marketplace], temporary, endpoint);
    await claudeCli(
        executable,
        ['plugin', 'install', 'debugging-cdp-targets@debugging-cdp-targets', '--json'],
        temporary,
        endpoint,
    );
    const host = await claudeHost(
        executable,
        temporary,
        endpoint,
        ['--settings', '{"disableAllHooks":true}'],
        prompt,
        undefined,
        90_000,
        { toolSearch: !exercise, recordOutput: !exercise },
    );
    if (failure) throw failure;
    assert.equal(count, exercise ? 3 : 1);
    const production = await initializationEvidence(fixtureEvidence);
    await writeFile(
        path.join(temporary, 'acceptance.json'),
        JSON.stringify(
            {
                host: 'Claude Code',
                version: host.version,
                source: await testedSource(root),
                locations,
                lifecycleCalls,
                ...(exercise ? { registrationId, ownedEmptyStatus: true } : {}),
                instructionLocation: locations[0],
                deferredDiscoveryLocation: locations[1],
                transportRole: 'user',
                ...production,
            },
            null,
            4,
        ),
    );
    console.log(
        `Claude ${host.version}: instruction locations ${locations.length}; host lifecycle calls ${lifecycleCalls.length}.`,
    );
} catch (error) {
    failure ??= error;
    throw error;
} finally {
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    if (failure) await writeFile(path.join(temporary, 'failure.txt'), String(failure));
}
