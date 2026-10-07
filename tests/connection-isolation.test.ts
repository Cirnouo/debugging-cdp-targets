import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DataDirectoryRegistry } from '../src/adapters/data-directory.ts';
import type { createMcpEntryServer } from '../src/adapters/mcp-entry-server.ts';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { startPluginRuntime } from '../src/application/plugin-runtime.ts';
import type { ConnectionStatus, ControlContext, LaunchOptions } from '../src/domains/control-contract.ts';
import type { DataIsolationEvidence } from '../src/domains/data-isolation.ts';
import { resolveLaunchDefinition } from '../src/domains/launch-command.ts';
import { isRecord } from '../src/shared/errors.ts';
import { hookResultEvents } from './fixtures/hook-gateway-events.ts';

function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class Application extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;
    exit() {
        this.exitCode = 0;
        this.emit('exit');
    }
    onMonitorError(listener: () => void) {
        this.on('monitor-error', listener);
        return () => {
            this.off('monitor-error', listener);
        };
    }
}

async function fixture(
    t: import('node:test').TestContext,
    options: {
        directories?: DataDirectoryRegistry;
        beforeCreation?: Promise<void>;
        afterCreation?: Promise<void>;
        replacementCreation?: Promise<void>;
        failLaunch?: number;
        failClose?: boolean;
        failUpstreamClose?: boolean;
        replacementRouter?: Promise<void>;
        profileAvailable?: (directory: string) => Promise<boolean>;
    } = {},
) {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-isolation-runtime-')));
    let callbacks: Parameters<typeof createMcpEntryServer>[0] | undefined;
    const closed = deferred();
    const launchEntered = deferred();
    const applications: Application[] = [];
    const launches: { options: LaunchOptions; directory?: string; arguments: string[] }[] = [];
    const tools = [{ name: 'list_pages', inputSchema: { type: 'object' as const, properties: {} } }];
    let routers = 0;
    let upstreams = 0;
    let failClose = options.failClose ?? false;
    let failUpstreamClose = options.failUpstreamClose ?? false;
    const runtime = await startPluginRuntime({
        ...(options.directories ? { dataDirectories: options.directories } : {}),
        ...(options.profileAvailable ? { profileAvailable: options.profileAvailable } : {}),
        loadCatalog: async () =>
            createToolCatalog({
                version: '1.10.1',
                tools: [{ name: 'list_pages', requires: {}, variants: tools }],
            }),
        createRouter: async () => {
            routers++;
            if (routers > 2) await options.replacementRouter;
            return {
                url: `http://127.0.0.1:${31000 + routers}`,
                setTarget: () => {},
                clearTarget: () => {},
                isBusy: () => false,
                close: async () => {},
            };
        },
        createHost: () => ({
            launch: async (launchOptions, context) => {
                launchEntered.resolve();
                await options.beforeCreation;
                const args =
                    context?.dataDirectory === undefined
                        ? [...(launchOptions.launch.args ?? [])]
                        : resolveLaunchDefinition(
                              launchOptions.launch,
                              launchOptions.exactPort ?? 9333,
                              process.env,
                              context.dataDirectory,
                          ).arguments;
                launches.push({
                    options: launchOptions,
                    ...(context?.dataDirectory === undefined ? {} : { directory: context.dataDirectory }),
                    arguments: args,
                });
                if (options.failLaunch === launches.length) throw new Error('Launch failed before creation.');
                const child = new Application();
                applications.push(child);
                const target = {
                    processId: 1000 + applications.length,
                    port: launchOptions.exactPort ?? 9333,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-07T00:00:00Z',
                    targetKind: 'generic-cdp' as const,
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: args, cwd: process.cwd() },
                };
                context?.onCreated?.(target);
                if (launches.length > 1) await options.replacementCreation;
                await options.afterCreation;
                context?.signal?.throwIfAborted();
                return target;
            },
            close: async (target) => {
                if (failClose) return false;
                const child = applications[target.processId - 1001];
                assert.ok(child);
                child.exit();
                return true;
            },
        }),
        createConnection: async () => {
            const catalog = ++upstreams === 1;
            return {
                tools,
                call: async () => ({ content: [] }),
                rootsChanged: async () => {},
                onExit: () => {},
                close: async () => {
                    if (!catalog && failUpstreamClose) throw new Error(`EACCES private path ${parent}`);
                },
            };
        },
        createEntry: (entry) => {
            callbacks = entry;
            return {
                connect: async () => {},
                closed: closed.promise,
                close: async () => closed.resolve(),
                roots: async () => ({ roots: [] }),
                supportsRoots: () => false,
                supportsFormElicitation: () => false,
                elicit: async () => ({ action: 'cancel' }),
            };
        },
    });
    assert.ok(callbacks);
    assert.ok(callbacks.control);
    const control = callbacks.control;
    t.after(async () => {
        failClose = false;
        failUpstreamClose = false;
        for (const child of applications) if (child.exitCode === null) child.exit();
        await runtime.close();
        await rm(parent, { recursive: true, force: true });
    });
    const evidence: DataIsolationEvidence[] = [];
    const updates = new Set<() => void>();
    const context: ControlContext = {
        onIsolation: (value) => {
            evidence.push(value);
            for (const update of updates) update();
        },
    };
    function dataOptions(cleanup: 'retain' | 'delete-on-release' = 'delete-on-release'): LaunchOptions {
        return {
            launch: { executable: process.execPath, args: ['--data={dataDir}'] },
            isolation: { mode: 'data-dir', directory: { kind: 'new', parent, name: 'profile' }, cleanup },
        };
    }
    async function waitState(state: string) {
        const latest = evidence.at(-1);
        if (latest?.mode === 'data-dir' && latest.state === state) return;
        await new Promise<void>((resolve) => {
            const update = () => {
                const current = evidence.at(-1);
                if (current?.mode === 'data-dir' && current.state === state) {
                    updates.delete(update);
                    resolve();
                }
            };
            updates.add(update);
            update();
        });
    }
    return {
        runtime,
        callbacks,
        control,
        parent,
        applications,
        launches,
        context,
        evidence,
        dataOptions,
        waitState,
        state: () => {
            const current = evidence.at(-1);
            return current?.mode === 'data-dir' ? current.state : undefined;
        },
        launchEntered: launchEntered.promise,
        allowUpstream: () => {
            failUpstreamClose = false;
        },
        allowClose: () => {
            failClose = false;
        },
    };
}

function route(connection: ConnectionStatus) {
    assert.ok(connection.sessionId);
    return { connectionId: connection.connectionId, sessionId: connection.sessionId };
}

test('prevalidation rejects missing binding and invalid official options before directory acquisition', async (t) => {
    const f = await fixture(t);
    const options = f.dataOptions();
    await assert.rejects(
        f.runtime.controller.start({ ...options, launch: { executable: process.execPath } }),
        /binding|dataDir/i,
    );
    await assert.rejects(f.runtime.controller.start({ ...options, mcpArgs: ['--browserUrl=http://example.com'] }));
    await assert.rejects(lstat(path.join(f.parent, 'profile')), { code: 'ENOENT' });
    assert.equal(f.launches.length, 0);
});

test('cancellation before acquisition leaves no directory evidence or filesystem effects', async (t) => {
    const f = await fixture(t);
    const abort = new AbortController();
    const reason = new Error('cancelled before start');
    abort.abort(reason);
    await assert.rejects(
        f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal }),
        (error: unknown) => error === reason,
    );
    assert.deepEqual(f.evidence, []);
    assert.deepEqual(await readdir(f.parent), []);
    assert.equal(f.launches.length, 0);
});

test('cancelled directory inspection holds acquisition until it settles without native launch', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const directories = new DataDirectoryRegistry({
        io: {
            entries: async (directory) => {
                await gate.promise;
                return readdir(directory);
            },
        },
    });
    const f = await fixture(t, { directories });
    const abort = new AbortController();
    const reason = new Error('cancelled during directory inspection');
    const pending = f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal });
    void pending.catch(() => {});
    await f.waitState('held');
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    abort.abort(reason);
    const closing = f.runtime.close();
    await tick();
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.equal(f.launches.length, 0);
    gate.resolve();
    await assert.rejects(pending, (error: unknown) => error === reason);
    await closing;
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('post-acquisition inspection failure preserves actual path and bounded cleanup evidence', async (t) => {
    const directories = new DataDirectoryRegistry({
        io: {
            entries: async (directory) => {
                throw new Error(`EACCES private inspection ${directory}`);
            },
        },
    });
    const f = await fixture(t, { directories });
    await assert.rejects(f.runtime.controller.start(f.dataOptions(), f.context), /directory-inspection-failed/);
    const result = f.evidence.at(-1);
    assert.ok(result?.mode === 'data-dir');
    assert.equal(result.path, path.join(f.parent, 'profile'));
    assert.equal(result.state, 'deleted');
    assert.equal(result.nonempty, undefined);
    assert.equal(f.launches.length, 0);
    await assert.rejects(lstat(result.path), { code: 'ENOENT' });
});

test('connection isolation is allocated once, held across restart and deleted after final Close', async (t) => {
    const f = await fixture(t);
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    assert.equal(held.path, path.join(f.parent, 'profile'));
    assert.equal(f.launches[0]?.directory, held.path);
    await writeFile(path.join(held.path, 'marker'), 'same directory');
    const replacement = await f.runtime.controller.restart(route(active));
    assert.equal(f.launches[1]?.directory, held.path);
    assert.equal(await readFile(path.join(held.path, 'marker'), 'utf8'), 'same directory');
    assert.equal(f.state(), 'held');
    await f.runtime.controller.stop({ ...route(replacement), disposition: 'Close' });
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('Keep and end-task retain the lease until actual exit applies whole-directory policy', async (t) => {
    const f = await fixture(t);
    const selected = path.join(f.parent, 'existing');
    await mkdir(selected);
    await writeFile(path.join(selected, 'prior'), 'pre-existing');
    const active = await f.runtime.controller.start(
        {
            ...f.dataOptions(),
            isolation: {
                mode: 'data-dir',
                directory: { kind: 'existing', path: selected },
                cleanup: 'delete-on-release',
            },
        },
        f.context,
    );
    assert.ok(f.evidence.at(-1)?.mode === 'data-dir');
    await f.runtime.controller.endTask(route(active));
    await f.runtime.controller.stop({ ...route(active), disposition: 'Keep' });
    assert.equal(await readFile(path.join(selected, 'prior'), 'utf8'), 'pre-existing');
    f.applications[0]?.exit();
    await f.waitState('deleted');
    await assert.rejects(lstat(selected), { code: 'ENOENT' });
    assert.throws(() => f.runtime.controller.status(active.connectionId), /closed|absent/);
});

test('failed restart retains directory until old resources successfully retry without restoring route', async (t) => {
    const f = await fixture(t, { failUpstreamClose: true });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    await assert.rejects(f.runtime.controller.restart(route(active)), /EACCES/);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.throws(() => f.runtime.controller.status(active.connectionId), /absent|closed/);
    f.allowUpstream();
    await f.runtime.close();
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('failed successor with no live app releases the directory after restart finishes', async (t) => {
    const f = await fixture(t, { failLaunch: 2 });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    await assert.rejects(f.runtime.controller.restart(route(active)), /Launch failed/);
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('late created app after cancelled acquisition blocks deletion until rollback actual exit', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await fixture(t, { beforeCreation: gate.promise, failClose: true });
    const abort = new AbortController();
    const pending = f.runtime.controller.start(f.dataOptions(), { ...f.context, signal: abort.signal });
    void pending.catch(() => {});
    await f.waitState('held');
    await f.launchEntered;
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    abort.abort(new Error('cancelled during permission'));
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(pending, /did not close/);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    f.applications[0]?.exit();
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('unconfirmed observation and failed Close preserve ownership and directory evidence', async (t) => {
    const f = await fixture(t, { failClose: true });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    f.applications[0]?.emit('monitor-error');
    await assert.rejects(f.runtime.controller.stop({ ...route(active), disposition: 'Close' }), /did not close/);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.equal(f.state(), 'held');
    f.allowClose();
    await f.runtime.controller.stop({ ...route(active), disposition: 'Close' });
    await f.waitState('deleted');
});

test('none exposes only explicit mode and summaries and Hooks omit directory and raw cleanup errors', async (t) => {
    const f = await fixture(t, { failUpstreamClose: true });
    const active = await f.runtime.controller.start(
        { launch: { executable: process.execPath }, isolation: { mode: 'none' } },
        f.context,
    );
    assert.deepEqual(f.evidence, [{ mode: 'none' }]);
    assert.equal('isolation' in active, false);
    assert.deepEqual(await import('node:fs/promises').then((fs) => fs.readdir(f.parent)), []);
    f.applications[0]?.exit();
    await tick();
    await tick();
    const hook = f.callbacks.status('PostToolUse');
    const text = JSON.stringify(hook);
    assert.ok(!text.includes(f.parent));
    assert.ok(!text.includes('EACCES private'));
    const events = hookResultEvents(hook);
    assert.equal(events[0]?.exits[0]?.cleanupStatus, 'failed');
});

test('idempotent start keeps original directory metadata after terminal actual exit without another notice', async (t) => {
    const f = await fixture(t);
    const request = {
        action: 'start' as const,
        entryId: f.runtime.entryId,
        requestId: 'same-start',
        ...f.dataOptions('retain'),
    };
    const accepted = await f.control(request);
    assert.ok(typeof accepted.operationId === 'string');
    let snapshot = accepted;
    while (snapshot.state !== 'succeeded') {
        const waited = await f.control({
            action: 'wait',
            entryId: f.runtime.entryId,
            operationId: accepted.operationId,
            cursor: typeof snapshot.cursor === 'number' ? snapshot.cursor : 0,
        });
        assert.ok(isRecord(waited.operation));
        snapshot = waited.operation;
    }
    assert.ok(isRecord(snapshot.isolation));
    const original = structuredClone(snapshot);
    const retry = await f.control(request);
    assert.equal(retry.operationId, accepted.operationId);
    assert.equal(f.launches.length, 1);
    assert.ok(typeof snapshot.connectionId === 'string' && typeof snapshot.sessionId === 'string');
    const selected = await f.control({
        action: 'status',
        entryId: f.runtime.entryId,
        connectionId: snapshot.connectionId,
        include: ['configuration'],
    });
    assert.deepEqual(selected.isolation, snapshot.isolation);
    f.applications[0]?.exit();
    for (let attempt = 0; attempt < 50; attempt++) {
        snapshot = await f.control({ action: 'status', entryId: f.runtime.entryId, operationId: accepted.operationId });
        if (isRecord(snapshot.isolation) && snapshot.isolation.state === 'retained') break;
        await tick();
    }
    assert.ok(isRecord(snapshot.isolation));
    assert.equal(snapshot.isolation.state, 'retained');
    assert.equal(snapshot.cursor, original.cursor);
    assert.deepEqual(snapshot.result, original.result);
    assert.equal(snapshot.state, original.state);
    const hook = hookResultEvents(f.callbacks.status('PostToolUse'));
    assert.equal(hook.flatMap((batch) => batch.operations).length, 0);
});

test('confirmed app exit while host acquisition is pending keeps the lease until launch settles', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await fixture(t, { afterCreation: gate.promise });
    const pending = f.runtime.controller.start(f.dataOptions(), f.context);
    void pending.catch(() => {});
    await f.launchEntered;
    await tick();
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    f.applications[0]?.exit();
    await tick();
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(pending, /exited|retired/);
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('actual successor exit racing restart completion wins final release after the successor hold', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await fixture(t, { replacementCreation: gate.promise });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    const pending = f.runtime.controller.restart(route(active));
    void pending.catch(() => {});
    while (f.applications.length < 2) await tick();
    f.applications[1]?.exit();
    await tick();
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(pending, /exited|retired/);
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
    assert.throws(() => f.runtime.controller.status(active.connectionId), /absent|closed/);
});

test('cancelled restart in the successor gap releases only after pending replacement resources settle', async (t) => {
    const gate = deferred();
    t.after(() => gate.resolve());
    const f = await fixture(t, { replacementRouter: gate.promise });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    const abort = new AbortController();
    const reason = new Error('cancelled successor');
    const pending = f.runtime.controller.restart(route(active), { signal: abort.signal });
    void pending.catch(() => {});
    while (f.applications[0]?.exitCode === null) await tick();
    abort.abort(reason);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    gate.resolve();
    await assert.rejects(
        pending,
        (error: unknown) =>
            error === reason || (error instanceof Error && /cancelled|retired|exited/.test(error.message)),
    );
    await f.waitState('deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('directory deletion failure keeps original start evidence for gateway cleanup retry', async (t) => {
    let fail = true;
    const directories = new DataDirectoryRegistry({
        io: {
            remove: async (directory) => {
                if (fail) throw new Error(`private filesystem failure ${directory}`);
                await rm(directory, { recursive: true });
            },
        },
    });
    const f = await fixture(t, { directories });
    const active = await f.runtime.controller.start(f.dataOptions(), f.context);
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    await assert.rejects(f.runtime.controller.stop({ ...route(active), disposition: 'Close' }), /cleanup/i);
    assert.equal(f.state(), 'cleanup-failed');
    assert.equal((await lstat(held.path)).isDirectory(), true);
    fail = false;
    await f.runtime.close();
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

test('failed Chrome startup never deletes an externally occupied selected directory', async (t) => {
    let occupied = true;
    const f = await fixture(t, { failLaunch: 1, profileAvailable: async () => !occupied });
    const selected = path.join(f.parent, 'external');
    await mkdir(selected);
    await writeFile(path.join(selected, 'prior'), 'external active data');
    await assert.rejects(
        f.runtime.controller.start(
            {
                targetKind: 'chrome',
                launch: { executable: process.execPath, args: ['--user-data-dir={dataDir}'] },
                isolation: {
                    mode: 'data-dir',
                    directory: { kind: 'existing', path: selected },
                    cleanup: 'delete-on-release',
                },
            },
            f.context,
        ),
        /Launch failed/,
    );
    assert.equal(await readFile(path.join(selected, 'prior'), 'utf8'), 'external active data');
    assert.equal(f.state(), 'cleanup-failed');
    occupied = false;
    await f.runtime.close();
    assert.equal(f.state(), 'deleted');
    await assert.rejects(lstat(selected), { code: 'ENOENT' });
});

test('Chrome release rechecks external native profile occupancy after our application exits', async (t) => {
    let occupied = false;
    const f = await fixture(t, { profileAvailable: async () => !occupied });
    const active = await f.runtime.controller.start(
        {
            ...f.dataOptions(),
            targetKind: 'chrome',
            launch: { executable: process.execPath, args: ['--user-data-dir={dataDir}'] },
        },
        f.context,
    );
    const held = f.evidence.at(-1);
    assert.ok(held?.mode === 'data-dir');
    occupied = true;
    await assert.rejects(f.runtime.controller.stop({ ...route(active), disposition: 'Close' }), /cleanup/i);
    assert.equal((await lstat(held.path)).isDirectory(), true);
    assert.equal(f.state(), 'cleanup-failed');
    occupied = false;
    await f.runtime.close();
    await assert.rejects(lstat(held.path), { code: 'ENOENT' });
});

for (const state of ['failed', 'cancelled'] as const) {
    test(`${state} start preserves acquired path and authorized final cleanup in operation metadata`, async (t) => {
        const gate = deferred();
        t.after(() => gate.resolve());
        const f = await fixture(t, state === 'failed' ? { failLaunch: 1 } : { beforeCreation: gate.promise });
        const accepted = await f.control({
            action: 'start',
            entryId: f.runtime.entryId,
            requestId: `start-${state}`,
            ...f.dataOptions(),
        });
        assert.ok(typeof accepted.operationId === 'string');
        if (state === 'cancelled') {
            await f.launchEntered;
            await f.control({ action: 'cancel', entryId: f.runtime.entryId, operationId: accepted.operationId });
            gate.resolve();
        }
        let snapshot = accepted;
        while (!['succeeded', 'failed', 'cancelled'].includes(String(snapshot.state))) {
            const waited = await f.control({
                action: 'wait',
                entryId: f.runtime.entryId,
                operationId: accepted.operationId,
                cursor: typeof snapshot.cursor === 'number' ? snapshot.cursor : 0,
            });
            assert.ok(isRecord(waited.operation));
            snapshot = waited.operation;
        }
        assert.equal(snapshot.state, state);
        assert.ok(isRecord(snapshot.isolation));
        assert.equal(snapshot.isolation.path, path.join(f.parent, 'profile'));
        assert.equal(snapshot.isolation.state, 'deleted');
        assert.ok(!String(JSON.stringify(snapshot.error)).includes(f.parent));
        await assert.rejects(lstat(String(snapshot.isolation.path)), { code: 'ENOENT' });
    });
}
