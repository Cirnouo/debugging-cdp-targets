import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Tool } from '@modelcontextprotocol/client';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
    createOfficialConnection,
    type OfficialConnection,
    type OfficialConnectionResource,
} from '../src/adapters/mcp-bridge.ts';
import { createMcpHttpServer } from '../src/adapters/mcp-http-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { createGatewayCore } from '../src/application/plugin-runtime.ts';
import type { Diagnostic } from '../src/shared/diagnostics.ts';
import { isRecord } from '../src/shared/errors.ts';

const first: Tool = {
    name: 'echo',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
};
const second: Tool = {
    ...first,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    outputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
    },
};
const other: Tool = { name: 'other', inputSchema: { type: 'object' } };

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

async function until(condition: () => boolean, label: string) {
    const deadline = performance.now() + 3000;
    while (!condition()) {
        if (performance.now() > deadline) assert.fail(label);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
}

type Page = { tools: Tool[]; nextCursor?: string; notifications?: number };
async function fixture(supportsChanges = true) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-catalog-refresh-'));
    const bin = path.join(directory, 'official.mjs');
    let lists = 0;
    let calls = 0;
    let activeLists = 0;
    let maxActiveLists = 0;
    let list: (cursor: string | undefined, index: number) => Promise<Page> = async () => ({ tools: [first] });
    let call: () => Promise<unknown> = async () => ({ content: [], structuredContent: { value: 1 } });
    const control = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert.ok(isRecord(input));
        let result: unknown;
        if (input.method === 'tools/list') {
            const cursor =
                isRecord(input.params) && typeof input.params.cursor === 'string' ? input.params.cursor : undefined;
            lists += 1;
            activeLists += 1;
            maxActiveLists = Math.max(maxActiveLists, activeLists);
            try {
                result = await list(cursor, lists);
            } finally {
                activeLists -= 1;
            }
        } else {
            calls += 1;
            result = await call();
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result));
    });
    await new Promise<void>((resolve) => control.listen(0, '127.0.0.1', resolve));
    const address = control.address();
    assert.ok(address && typeof address !== 'string');
    await writeFile(
        bin,
        `import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server'))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server/stdio'))};
const server = new Server({ name: 'catalog-changing-official', version: '1' }, { capabilities: { tools: ${supportsChanges ? '{ listChanged: true }' : '{}'} } });
async function control(request) {
    return (await fetch('http://127.0.0.1:${address.port}', { method: 'POST', body: JSON.stringify(request) })).json();
}
server.setRequestHandler('tools/list', async (request) => {
    const { notifications, ...page } = await control(request);
    for (let i = 0; i < (notifications ?? 0); i++) await server.sendToolListChanged();
    return page;
});
server.setRequestHandler('tools/call', control);
server.setNotificationHandler('notifications/roots/list_changed', async () => {
    await server.notification({ method: 'notifications/tools/list_changed' });
});
process.stdin.once('end', () => server.close().then(() => process.exit(0)));
await server.connect(new StdioServerTransport());
`,
        'utf8',
    );
    const catalog = createToolCatalog({
        version: '1.11.0',
        tools: [
            { name: 'echo', requires: {}, variants: [first, second] },
            { name: 'other', requires: {}, variants: [other] },
        ],
    });
    const diagnostics: Diagnostic[] = [];
    return {
        options: {
            bin,
            args: [],
            roots: async () => ({ roots: [] }),
            validateTools: catalog.validate,
            diagnose: (event: Diagnostic) => diagnostics.push(event),
        },
        diagnostics,
        catalog,
        counts: () => ({ lists, calls, maxActiveLists }),
        list: (handler: typeof list) => {
            list = handler;
        },
        call: (handler: typeof call) => {
            call = handler;
        },
        async cleanup() {
            await new Promise<void>((resolve, reject) => control.close((error) => (error ? reject(error) : resolve())));
            await rm(directory, { recursive: true, force: true });
        },
    };
}

test('real SDK notifications atomically refresh complete reviewed snapshots and defensive views', async () => {
    const f = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    try {
        assert.deepEqual(connection.toolCatalog, { revision: 1, state: 'current' });
        const saved = connection.tools;
        saved.splice(0);
        assert.equal(connection.tools.length, 1);
        f.list(async () => ({ tools: [second, other] }));
        await connection.rootsChanged();
        await until(() => connection.toolCatalog?.revision === 2, 'SDK notification must publish a replacement');
        assert.deepEqual(connection.tools, [second, other]);
        assert.deepEqual(connection.toolCatalog, { revision: 2, state: 'current' });
        f.call(async () => ({ content: [], structuredContent: { value: 'new schema' } }));
        assert.deepEqual((await connection.call('echo', {})).structuredContent, { value: 'new schema' });
        assert.equal(f.counts().calls, 1);
    } finally {
        await connection.close();
        await f.cleanup();
    }
});

test('notification during initial enumeration drains a coalesced follow-up before readiness', async () => {
    const f = await fixture();
    f.list(async (_cursor, index) => (index === 1 ? { tools: [first], notifications: 8 } : { tools: [second] }));
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    try {
        assert.deepEqual(connection.tools, [second]);
        assert.equal(f.counts().lists, 2);
        assert.equal(f.counts().maxActiveLists, 1);
    } finally {
        await connection.close();
        await f.cleanup();
    }
});

test('a failed dirty initial follow-up rejects acquisition without an unhandled background refresh', async () => {
    const f = await fixture();
    let acquired: OfficialConnectionResource | undefined;
    f.list(async (_cursor, index) =>
        index === 1 ? { tools: [first], notifications: 3 } : { tools: [{ ...first, name: 'unreviewed' }] },
    );
    try {
        await assert.rejects(
            createOfficialConnection('http://127.0.0.1:9222', {
                ...f.options,
                onAcquired: (resource) => {
                    acquired = resource;
                },
            }),
            /reviewed|catalog/,
        );
        assert.equal(f.counts().lists, 2);
        assert.equal(f.counts().calls, 0);
    } finally {
        await acquired?.close();
        await f.cleanup();
    }
});

test('refresh bursts serialize one dirty follow-up while readers retain a whole snapshot', async () => {
    const f = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    const held = deferred<Page>();
    try {
        f.list(async (_cursor, index) => (index === 2 ? held.promise : { tools: [second, other] }));
        await connection.rootsChanged();
        await until(() => f.counts().lists === 2, 'first refresh must start');
        await Promise.all(Array.from({ length: 12 }, () => connection.rootsChanged()));
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        assert.deepEqual(connection.tools, [first]);
        assert.equal(f.counts().lists, 2);
        held.resolve({ tools: [other] });
        await until(() => connection.toolCatalog?.revision === 3, 'dirty follow-up must publish');
        assert.deepEqual(connection.tools, [second, other]);
        assert.equal(f.counts().lists, 3);
        assert.equal(f.counts().maxActiveLists, 1);
    } finally {
        held.resolve({ tools: [] });
        await connection.close();
        await f.cleanup();
    }
});

test('refresh walks beyond 64 pages and rejects an invalid later page without partial publication', async () => {
    const f = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    try {
        f.list(async (cursor) => {
            const page = Number(cursor ?? 0);
            return { tools: page === 64 ? [second] : [], ...(page < 64 ? { nextCursor: String(page + 1) } : {}) };
        });
        await connection.rootsChanged();
        await until(() => connection.toolCatalog?.revision === 2, '65-page refreshed catalog must publish');
        assert.equal(f.counts().lists, 66);
        assert.deepEqual(connection.tools, [second]);
        f.list(async (cursor) => ({ tools: cursor ? [second] : [other], nextCursor: 'repeat' }));
        await connection.rootsChanged();
        await until(() => connection.toolCatalog?.state === 'unavailable', 'repeated cursor must fail refresh');
        assert.deepEqual(connection.tools, [second]);
        assert.equal(connection.toolCatalog?.revision, 2);
    } finally {
        await connection.close();
        await f.cleanup();
    }
});

const invalidCatalogs: [string, Tool[]][] = [
    ['duplicate names', [first, first]],
    ['unknown name', [{ ...first, name: 'unreviewed' }]],
    ['input schema', [{ ...first, inputSchema: { type: 'object' as const, required: ['unreviewed'] } }]],
    ['output schema', [{ ...first, outputSchema: { type: 'object' as const } }]],
    ['reserved routing', [{ ...first, inputSchema: { type: 'object' as const, properties: { _dct: {} } } }]],
];
for (const [label, tools] of invalidCatalogs) {
    test(`failed ${label} refresh retains healthy resources and blocks admission until metadata recovery`, async () => {
        const f = await fixture();
        const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
        let exits = 0;
        connection.onExit(() => {
            exits += 1;
        });
        try {
            f.list(async () => ({ tools: [...tools] }));
            await connection.rootsChanged();
            await until(
                () => connection.toolCatalog?.state === 'unavailable',
                'invalid refresh must become unavailable',
            );
            assert.deepEqual(connection.tools, [first]);
            const failedLists = f.counts().lists;
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            assert.equal(f.counts().lists, failedLists, 'Failed metadata refresh cannot schedule a retry loop.');
            assert.equal(
                f.diagnostics.filter((event) => event.phase === 'tool-catalog-refresh' && event.outcome === 'failed')
                    .length,
                1,
            );
            await assert.rejects(connection.call('echo', {}), (error: unknown) => {
                assert.ok(isRecord(error));
                assert.equal(error.code, 'OFFICIAL_CATALOG_UNAVAILABLE');
                return true;
            });
            assert.equal(f.counts().calls, 0);
            assert.equal(exits, 0);
            f.list(async () => ({ tools: [second] }));
            f.call(async () => ({ content: [], structuredContent: { value: 'recovered' } }));
            if (label === 'duplicate names') {
                await connection.rootsChanged();
                await until(
                    () => connection.toolCatalog?.state === 'current',
                    'a later notification must recover metadata without a call',
                );
            }
            assert.deepEqual((await connection.call('echo', {})).structuredContent, { value: 'recovered' });
            assert.equal(f.counts().calls, 1);
            assert.equal(exits, 0);
            assert.equal(connection.toolCatalog?.state, 'current');
        } finally {
            await connection.close();
            await f.cleanup();
        }
    });
}

test('an in-flight SDK call retains its admitted output definition through successful and failed refreshes', async () => {
    const f = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    const result = deferred<unknown>();
    try {
        f.call(() => result.promise);
        const original = connection.call('echo', {});
        await until(() => f.counts().calls === 1, 'original official execution must start');
        f.list(async () => ({ tools: [second] }));
        await connection.rootsChanged();
        await until(() => connection.toolCatalog?.revision === 2, 'new definition must publish during call');
        f.list(async () => ({ tools: [{ ...first, name: 'invalid' }] }));
        await connection.rootsChanged();
        await until(
            () => connection.toolCatalog?.state === 'unavailable',
            'failed refresh must not end the original call',
        );
        result.resolve({ content: [], structuredContent: { value: 42 } });
        assert.deepEqual((await original).structuredContent, { value: 42 });
        assert.equal(f.counts().calls, 1);
        assert.deepEqual(connection.tools, [second]);
    } finally {
        result.resolve({ content: [] });
        await connection.close();
        await f.cleanup();
    }
});

test('tool removal during admission never forwards through the earlier snapshot', async () => {
    const f = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    const held = deferred<Page>();
    try {
        f.list(() => held.promise);
        await connection.rootsChanged();
        await until(() => f.counts().lists === 2, 'admission must observe a pending refresh');
        const call = connection.call('echo', {});
        void call.catch(() => {});
        held.resolve({ tools: [other] });
        await assert.rejects(call, /enabled|available/i);
        assert.equal(f.counts().calls, 0);
    } finally {
        held.resolve({ tools: [] });
        await connection.close();
        await f.cleanup();
    }
});

test('Close fences late refresh publication and diagnostics without affecting an independent successor', async () => {
    const f = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    const held = deferred<Page>();
    let successor: Awaited<ReturnType<typeof createOfficialConnection>> | undefined;
    try {
        f.list(async (_cursor, index) => (index === 2 ? held.promise : { tools: [second] }));
        await connection.rootsChanged();
        await until(() => f.counts().lists === 2, 'retired generation must have a pending refresh');
        const previous = connection.toolCatalog;
        await connection.close();
        const diagnosticCount = f.diagnostics.length;
        successor = await createOfficialConnection('http://127.0.0.1:9222', f.options);
        held.resolve({ tools: [other], notifications: 4 });
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        assert.deepEqual(connection.toolCatalog, previous);
        assert.deepEqual(connection.tools, [first]);
        assert.deepEqual(successor.tools, [second]);
        assert.deepEqual(successor.toolCatalog, { revision: 1, state: 'current' });
        assert.equal(f.diagnostics.filter((event) => event.outcome === 'failed').length, 0);
        assert.ok(f.diagnostics.length >= diagnosticCount);
    } finally {
        held.resolve({ tools: [] });
        await connection.close();
        await successor?.close();
        await f.cleanup();
    }
});

test('a server without listChanged support keeps startup-only knowledge', async () => {
    const f = await fixture(false);
    const connection = await createOfficialConnection('http://127.0.0.1:9222', f.options);
    try {
        f.list(async () => ({ tools: [second] }));
        await connection.rootsChanged();
        await connection.call('echo', {});
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        assert.equal(f.counts().lists, 1);
        assert.deepEqual(connection.tools, [first]);
    } finally {
        await connection.close();
        await f.cleanup();
    }
});

async function coreFixture(initialTools?: Tool[]) {
    const f = await fixture();
    if (initialTools) f.list(async () => ({ tools: initialTools }));
    const upstreams: OfficialConnection[] = [];
    const diagnosticSinks: NonNullable<Parameters<typeof createOfficialConnection>[1]>['diagnose'][] = [];
    let health: () => Promise<void> = async () => {};
    const children = new Map<number, EventEmitter>();
    let launched = 0;
    let closed = 0;
    const core = await createGatewayCore({
        loadCatalog: async () => f.catalog,
        createRouter: async () => ({
            url: 'http://127.0.0.1:30000',
            isBusy: () => false,
            setTarget() {},
            clearTarget() {},
            close: async () => {},
        }),
        createHost: () => ({
            launch: async () => {
                const processId = ++launched;
                const child = new EventEmitter();
                children.set(processId, child);
                return {
                    processId,
                    port: 9222 + processId,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-17T00:00:00Z',
                    targetKind: 'generic-cdp',
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                    verify: () => health(),
                };
            },
            close: async (target) => {
                closed += 1;
                children.get(target.processId)?.emit('exit');
                return true;
            },
        }),
        createConnection: async (url, options) => {
            diagnosticSinks.push(options?.diagnose);
            const connection = await createOfficialConnection(url, {
                ...f.options,
                ...options,
                bin: f.options.bin,
                args: [],
            });
            upstreams.push(connection);
            return connection;
        },
    });
    const registration = core.register();
    const handle = core.attachClient(registration.bearer);
    const context = () => handle.request({ requestId: 0, capabilities: { roots: false, formElicitation: false } });
    const target = await core.controller.start(
        { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
        { client: context() },
    );
    const status = (include?: ('configuration' | 'diagnostics')[]) =>
        core.control(
            {
                action: 'status',
                connectionId: target.connectionId,
                toolNames: ['echo', 'other'],
                ...(include ? { include } : {}),
            },
            context(),
        );
    return {
        ...f,
        core,
        target,
        context,
        upstreams,
        diagnosticSinks,
        status,
        health: (handler: typeof health) => {
            health = handler;
        },
        resources: () => ({ launched, closed }),
        cleanup: async () => {
            await core.cleanup();
            await f.cleanup();
        },
    };
}

test('selected Core status reports last-known freshness while outward SDK tools remain byte-equivalent', async () => {
    const f = await coreFixture();
    const http = await createMcpHttpServer({ port: 0, core: f.core });
    const client = new Client({ name: 'catalog-observer', version: '1' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
        const outward = JSON.stringify((await client.listTools()).tools);
        const upstream = f.upstreams[1];
        assert.ok(upstream);
        f.list(async () => ({ tools: [second, other] }));
        await upstream.rootsChanged();
        await until(() => upstream.toolCatalog?.revision === 2, 'real target metadata refresh must publish');
        const selected = await f.status(['configuration']);
        assert.deepEqual(selected.toolCatalog, { revision: 2, state: 'current' });
        assert.ok(isRecord(selected.official));
        assert.deepEqual(selected.official.toolCatalog, { revision: 2, state: 'current' });
        assert.ok(Array.isArray(selected.toolAvailability));
        assert.deepEqual(
            selected.toolAvailability.map((item: unknown) => (isRecord(item) ? item.enabled : undefined)),
            [true, true],
        );
        assert.equal(JSON.stringify((await client.listTools()).tools), outward);
        f.list(async () => ({ tools: [{ ...first, name: 'unknown' }] }));
        await upstream.rootsChanged();
        await until(
            () => upstream.toolCatalog?.state === 'unavailable',
            'invalid catalog must retain selected details',
        );
        const unavailable = await f.status(['diagnostics']);
        assert.deepEqual(unavailable.toolCatalog, { revision: 2, state: 'unavailable' });
        assert.ok(Array.isArray(unavailable.toolAvailability));
        assert.ok(isRecord(unavailable.toolAvailability[0]));
        assert.deepEqual(unavailable.toolAvailability[0].inputSchema, second.inputSchema);
        assert.deepEqual(unavailable.toolAvailability[0].outputSchema, second.outputSchema);
        assert.equal(JSON.stringify((await client.listTools()).tools), outward);
        assert.deepEqual(f.resources(), { launched: 1, closed: 0 });
    } finally {
        await client.close();
        await http.close();
        await f.cleanup();
    }
});

test('Core health await cannot forward a tool removed before actual SDK admission', async () => {
    const f = await coreFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    try {
        f.health(async () => {
            entered.resolve();
            await release.promise;
        });
        const pending = f.core.invoke(
            'echo',
            { _dct: { connectionId: f.target.connectionId, sessionId: f.target.sessionId } },
            f.context(),
        );
        void pending.catch(() => {});
        await entered.promise;
        const upstream = f.upstreams[1];
        assert.ok(upstream);
        f.list(async () => ({ tools: [other] }));
        await upstream.rootsChanged();
        await until(() => upstream.toolCatalog?.revision === 2, 'removal must publish during health await');
        release.resolve();
        await assert.rejects(pending, /enabled|available/);
        assert.equal(f.counts().calls, 0);
    } finally {
        release.resolve();
        await f.cleanup();
    }
});

test('Core absent-tool admission awaits a held catalog refresh that enables the requested name', async () => {
    const f = await coreFixture([other]);
    const held = deferred<Page>();
    let pending: Promise<unknown> | undefined;
    try {
        const upstream = f.upstreams[1];
        assert.ok(upstream);
        const baseline = f.counts().lists;
        f.list(async () => held.promise);
        await upstream.rootsChanged();
        await until(() => f.counts().lists === baseline + 1, 'held catalog refresh must start');
        let settled = false;
        pending = f.core
            .invoke(
                'echo',
                {
                    _dct: { connectionId: f.target.connectionId, sessionId: f.target.sessionId },
                },
                f.context(),
            )
            .finally(() => {
                settled = true;
            });
        void pending.catch(() => {});
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(settled, false, 'last-known absence cannot decide while metadata admission is pending');
        assert.equal(f.counts().calls, 0);
        assert.deepEqual(f.resources(), { launched: 1, closed: 0 });
        held.resolve({ tools: [first, other] });
        const result = await pending;
        assert.ok(isRecord(result));
        assert.deepEqual(result.structuredContent, { value: 1 });
        assert.equal(f.counts().calls, 1);
        assert.equal(f.counts().lists, baseline + 1);
        assert.deepEqual(upstream.toolCatalog, { revision: 2, state: 'current' });
    } finally {
        held.resolve({ tools: [] });
        await pending?.catch(() => {});
        await f.cleanup();
    }
});

test('Core absent-tool admission recovers unavailable metadata on that same requested tool', async () => {
    const f = await coreFixture([other]);
    try {
        const upstream = f.upstreams[1];
        assert.ok(upstream);
        f.list(async () => ({ tools: [{ ...first, name: 'unreviewed' }] }));
        await upstream.rootsChanged();
        await until(() => upstream.toolCatalog?.state === 'unavailable', 'catalog failure must precede admission');
        const baseline = f.counts().lists;
        f.list(async () => ({ tools: [first, other] }));
        const result = await f.core.invoke(
            'echo',
            {
                _dct: { connectionId: f.target.connectionId, sessionId: f.target.sessionId },
            },
            f.context(),
        );
        assert.deepEqual(result.structuredContent, { value: 1 });
        assert.equal(f.counts().calls, 1);
        assert.equal(f.counts().lists, baseline + 1);
        assert.deepEqual(upstream.toolCatalog, { revision: 2, state: 'current' });
        assert.deepEqual(f.resources(), { launched: 1, closed: 0 });
    } finally {
        await f.cleanup();
    }
});

test('Core absent-tool admission reports repeated unavailable validation without forwarding', async () => {
    const f = await coreFixture([other]);
    try {
        const upstream = f.upstreams[1];
        assert.ok(upstream);
        f.list(async () => ({ tools: [{ ...first, name: 'unreviewed-private-fixture' }] }));
        await upstream.rootsChanged();
        await until(() => upstream.toolCatalog?.state === 'unavailable', 'invalid catalog must become unavailable');
        const baseline = f.counts().lists;
        for (let attempt = 1; attempt <= 2; attempt++) {
            await assert.rejects(
                f.core.invoke(
                    'echo',
                    {
                        _dct: { connectionId: f.target.connectionId, sessionId: f.target.sessionId },
                    },
                    f.context(),
                ),
                (error: unknown) => {
                    assert.ok(error instanceof Error && isRecord(error));
                    assert.equal(error.code, 'OFFICIAL_CATALOG_UNAVAILABLE');
                    assert.match(error.message, /catalog is unavailable/i);
                    assert.doesNotMatch(error.message, /unreviewed-private-fixture/);
                    return true;
                },
            );
            assert.equal(f.counts().lists, baseline + attempt, 'one metadata walk per admission, with no retry loop');
            assert.equal(f.counts().calls, 0);
            assert.deepEqual(upstream.tools, [other]);
            assert.deepEqual(upstream.toolCatalog, { revision: 1, state: 'unavailable' });
            assert.deepEqual(f.resources(), { launched: 1, closed: 0 });
        }
    } finally {
        await f.cleanup();
    }
});

test('Core current absent-tool admission retains the complete existing disabled replacement recipe', async () => {
    const f = await coreFixture();
    try {
        const upstream = f.upstreams[1];
        assert.ok(upstream);
        f.list(async () => ({ tools: [other] }));
        await upstream.rootsChanged();
        await until(() => upstream.toolCatalog?.revision === 2, 'current absence must be newly validated');
        const result = await f.core.invoke(
            'echo',
            {
                _dct: { connectionId: f.target.connectionId, sessionId: f.target.sessionId },
            },
            f.context(),
        );
        assert.equal(result.isError, true);
        assert.deepEqual(result.structuredContent, {
            code: 'TOOL_NOT_ENABLED',
            connectionId: f.target.connectionId,
            sessionId: f.target.sessionId,
            name: 'echo',
            supported: true,
            conditions: [],
            missingConditions: [],
            suggestedMcpArgs: ['--categoryExtensions=true', '--no-usage-statistics', '--no-performance-crux'],
            nextAction: 'close-and-new-start',
        });
        assert.equal(f.counts().calls, 0);
        assert.deepEqual(upstream.toolCatalog, { revision: 2, state: 'current' });
        assert.deepEqual(f.resources(), { launched: 1, closed: 0 });
    } finally {
        await f.cleanup();
    }
});

test('target-only restart retains refreshed official catalog and diagnostics follow its current target owner', async () => {
    const f = await coreFixture();
    try {
        const original = f.upstreams[1];
        assert.ok(original);
        f.list(async () => ({ tools: [second] }));
        await original.rootsChanged();
        await until(() => original.toolCatalog?.revision === 2, 'official catalog must refresh before target restart');
        const restarted = await f.core.controller.restart({
            connectionId: f.target.connectionId,
            sessionId: f.target.sessionId ?? '',
            scope: 'target',
        });
        assert.equal(f.upstreams.length, 2);
        assert.equal(f.upstreams[1], original);
        assert.deepEqual(original.tools, [second]);
        assert.deepEqual(original.toolCatalog, { revision: 2, state: 'current' });
        f.list(async () => ({ tools: [{ ...first, name: 'invalid' }] }));
        await original.rootsChanged();
        await until(() => original.toolCatalog?.state === 'unavailable', 'retained upstream must still refresh');
        const selected = await f.status(['diagnostics']);
        assert.ok(Array.isArray(selected.diagnostics));
        assert.ok(
            selected.diagnostics.some(
                (event: unknown) =>
                    isRecord(event) && event.phase === 'tool-catalog-refresh' && event.outcome === 'failed',
            ),
        );
        assert.notEqual(restarted.sessionId, f.target.sessionId);
    } finally {
        await f.cleanup();
    }
});

test('official-only restart rejects stale pages and diagnostic callbacks from the retired generation', async () => {
    const f = await coreFixture();
    const held = deferred<Page>();
    try {
        const original = f.upstreams[1];
        assert.ok(original);
        const baseline = f.counts().lists;
        f.list(async (_cursor, index) => (index === baseline + 1 ? held.promise : { tools: [second] }));
        await original.rootsChanged();
        await until(() => f.counts().lists === baseline + 1, 'old official refresh must be pending');
        const restarted = await f.core.controller.restart({
            connectionId: f.target.connectionId,
            sessionId: f.target.sessionId ?? '',
            scope: 'official',
        });
        const successor = f.upstreams[2];
        assert.ok(successor);
        assert.deepEqual(successor.tools, [second]);
        const before = await f.status(['diagnostics']);
        f.diagnosticSinks[1]?.({ phase: 'tool-catalog-refresh', outcome: 'failed', elapsedMs: 123 });
        held.resolve({ tools: [{ ...first, name: 'unreviewed' }], notifications: 4 });
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        const after = await f.status(['diagnostics']);
        assert.deepEqual(after.diagnostics, before.diagnostics);
        assert.deepEqual(successor.tools, [second]);
        assert.deepEqual(successor.toolCatalog, { revision: 1, state: 'current' });
        assert.notEqual(restarted.sessionId, f.target.sessionId);
        assert.deepEqual(f.resources(), { launched: 1, closed: 0 });
    } finally {
        held.resolve({ tools: [] });
        await f.cleanup();
    }
});
