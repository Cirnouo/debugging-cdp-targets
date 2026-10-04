import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createToolCatalog } from '../../src/adapters/tool-catalog.ts';
import { startPluginRuntime } from '../../src/application/plugin-runtime.ts';

// Replace only OS/CDP/upstream I/O; use the production gateway, controller and SDK.
const statePath = process.env.DCT_HOOK_FIXTURE_STATE;
if (!statePath) throw new Error('Missing isolated Hook fixture state path.');
const lifecycle: { exitCode: number | null; signalCode: string | null } = { exitCode: null, signalCode: null };
const child = Object.assign(new EventEmitter(), lifecycle);
const exit = () => {
    child.exitCode = 0;
    child.emit('exit', 0);
};
const signal = createServer((_request, response) => {
    exit();
    response.end('{}');
});
await new Promise<void>((resolve) => signal.listen(0, '127.0.0.1', resolve));
const address = signal.address();
if (!address || typeof address === 'string') throw new Error('Missing fixture listener.');
const runtime = await startPluginRuntime({
    loadCatalog: async (tools = []) =>
        createToolCatalog({
            version: '1.10.1',
            tools: tools.map((tool) => ({ name: tool.name, requires: {}, variants: [tool] })),
        }),
    createRouter: async () => ({
        url: 'http://127.0.0.1:12345',
        isBusy: () => false,
        setTarget: () => {},
        clearTarget: () => {},
        close: async () => {},
    }),
    createHost: () => ({
        launch: async () => ({
            processId: 4242,
            port: 9222,
            executablePath: process.execPath,
            child,
            startedAtUtc: '2026-10-02T00:00:00Z',
            targetKind: 'generic-cdp',
            launchDefinition: { executablePath: process.execPath, arguments: [], cwd: process.cwd() },
        }),
        close: async () => true,
        health: async () => 'healthy',
    }),
    createConnection: async () => ({
        tools: [{ name: 'list_pages', inputSchema: { type: 'object', properties: {} } }],
        call: async () => {
            if (process.env.DCT_HOOK_FIXTURE_EXIT === 'post') exit();
            return { content: [{ type: 'text', text: '0: fixture page' }] };
        },
        onExit: () => {},
        close: async () => {},
        rootsChanged: async () => {},
    }),
});
const current = await runtime.controller.start({ launch: { executable: 'fake target' } });
await writeFile(
    `${statePath}.${current.connectionId}`,
    JSON.stringify({ ...current, signalUrl: `http://127.0.0.1:${address.port}` }),
);
await runtime.closed;
await new Promise<void>((resolve, reject) => signal.close((error) => (error ? reject(error) : resolve())));
