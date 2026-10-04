import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createToolCatalog } from '../../src/adapters/tool-catalog.ts';
import { startPluginRuntime } from '../../src/application/plugin-runtime.ts';
import type { ManagedTarget } from '../../src/domains/cdp-target.ts';

// Replace only OS/CDP/upstream I/O; use the production gateway, controller and SDK.
const statePath = process.env.DCT_HOOK_FIXTURE_STATE;
if (!statePath) throw new Error('Missing isolated Hook fixture state path.');
const targets = new Map<number, ManagedTarget>();
const routers = new Map<string, { target?: ManagedTarget }>();
const heldStarts = new Set<() => void>();
let launches = 0;
let routerIndex = 0;
function exit(processId: number) {
    const child = targets.get(processId)?.child;
    if (!child || child.exitCode !== null) return;
    child.exitCode = 0;
    if (child instanceof EventEmitter) child.emit('exit', 0);
}
const signal = createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/release-start') for (const release of [...heldStarts]) release();
        else {
            const processId = Number(url.searchParams.get('pid'));
            if (!targets.has(processId)) throw new Error('Unknown isolated fixture target.');
            exit(processId);
        }
        // Let the production lifecycle settle before acknowledging the fixture trigger.
        await new Promise<void>((resolve) => setImmediate(resolve));
        response.end('{}');
    } catch {
        response.writeHead(400);
        response.end('{}');
    }
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
    createRouter: async () => {
        const url = `http://127.0.0.1:${12345 + routerIndex++}`;
        const route: { target?: ManagedTarget } = {};
        routers.set(url, route);
        return {
            url,
            isBusy: () => false,
            setTarget: (target) => {
                route.target = target;
            },
            clearTarget: () => {
                delete route.target;
            },
            close: async () => {
                routers.delete(url);
            },
        };
    },
    createHost: () => ({
        launch: async (_options, context) => {
            const index = launches++;
            if (index > 0 && process.env.DCT_HOOK_FIXTURE_EXIT === 'lifecycle')
                await new Promise<void>((resolve, reject) => {
                    const finish = () => {
                        heldStarts.delete(finish);
                        context?.signal?.removeEventListener('abort', aborted);
                        resolve();
                    };
                    const aborted = () => {
                        heldStarts.delete(finish);
                        reject(context?.signal?.reason);
                    };
                    heldStarts.add(finish);
                    context?.signal?.addEventListener('abort', aborted, { once: true });
                    if (context?.signal?.aborted) aborted();
                });
            context?.signal?.throwIfAborted();
            const child = Object.assign(new EventEmitter(), {
                exitCode: null as number | null,
                signalCode: null as string | null,
            });
            const target: ManagedTarget = {
                processId: 4242 + index,
                port: 9222 + index,
                executablePath: process.execPath,
                child,
                startedAtUtc: '2026-10-02T00:00:00Z',
                targetKind: 'generic-cdp',
                launchDefinition: { executablePath: process.execPath, arguments: [], cwd: process.cwd() },
            };
            targets.set(target.processId, target);
            context?.onCreated?.(target);
            return target;
        },
        close: async (target) => {
            exit(target.processId);
            return true;
        },
        health: async () => 'healthy',
    }),
    createConnection: async (url) => ({
        tools: [{ name: 'list_pages', inputSchema: { type: 'object', properties: {} } }],
        call: async () => {
            const processId = routers.get(url)?.target?.processId;
            if (process.env.DCT_HOOK_FIXTURE_EXIT === 'post' && processId !== undefined) {
                // Runtime validation and the SDK success response finish in this
                // turn's microtasks; exit/cleanup precede the next host Hook I/O.
                setImmediate(() => exit(processId));
            }
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
    JSON.stringify({
        ...current,
        signalUrl: `http://127.0.0.1:${address.port}/exit?pid=${current.processId}`,
        releaseUrl: `http://127.0.0.1:${address.port}/release-start`,
    }),
);
await runtime.closed;
await new Promise<void>((resolve, reject) => signal.close((error) => (error ? reject(error) : resolve())));
