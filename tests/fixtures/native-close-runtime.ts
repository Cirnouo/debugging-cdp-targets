import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { TestContext } from 'node:test';
import { DataDirectoryRegistry } from '../../src/adapters/data-directory.ts';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import { createToolCatalog } from '../../src/adapters/tool-catalog.ts';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import type { ConnectionStatus, ControlRequest } from '../../src/domains/control-contract.ts';
import { parseControlRequest } from '../../src/domains/control-contract.ts';
import type { DataIsolationEvidence } from '../../src/domains/data-isolation.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { createCoreFixture } from './core-runtime.ts';

export function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

export const nativeIdentity = {
    processId: 1601,
    startedAtUtc: '2026-10-12T01:00:00.000Z',
};

/** Real ownership stack; only native/process/network and MCP transport I/O are replaced. */
export async function nativeCloseRuntime(t: TestContext) {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-native-close-runtime-')));
    const profile = path.join(parent, 'profile');
    const accepted = deferred();
    const upstreamDisposing = deferred();
    const upstreamDisposal = deferred();
    const deleted = deferred();
    const helpers: ReturnType<typeof makeHelper>[] = [];
    const requests: Record<string, unknown>[] = [];
    const isolation: DataIsolationEvidence[] = [];
    const order: string[] = [];
    let listenerPresent = true;
    let officialCalls = 0;
    let connectionCount = 0;
    let routerCount = 0;

    function makeHelper() {
        const child = Object.assign(new ChildProcess(), {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
        });
        Object.defineProperty(child, 'pid', { value: 1501 + helpers.length });
        const emit = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
        let input = '';
        child.stdin.on('data', (chunk: Buffer) => {
            input += chunk.toString();
            let newline = input.indexOf('\n');
            while (newline >= 0) {
                const value: unknown = JSON.parse(input.slice(0, newline));
                input = input.slice(newline + 1);
                assert.ok(isRecord(value));
                requests.push(value);
                if (value.action === 'launch') {
                    assert.ok(isRecord(value.launch));
                    const executablePath = value.launch.executablePath;
                    queueMicrotask(() =>
                        emit({ event: 'started', ...nativeIdentity, executablePath, elevated: false }),
                    );
                } else if (value.action === 'close') {
                    assert.ok(isRecord(value.target));
                    assert.equal(value.target.processId, 1601);
                    assert.equal(value.target.startedAtUtc, '2026-10-12T01:00:00.000Z');
                    listenerPresent = false;
                    queueMicrotask(() => {
                        emit({
                            event: 'close-requested',
                            ...nativeIdentity,
                            closeRequested: true,
                            processExited: false,
                            phase: 'normal-close',
                            nativeError: 0,
                        });
                        accepted.resolve();
                    });
                } else assert.equal(value.cancel, true);
                newline = input.indexOf('\n');
            }
        });
        return { child, emit };
    }

    const launcher = createWindowsLauncher({
        spawn: () => {
            const helper = makeHelper();
            helpers.push(helper);
            return helper.child;
        },
    });
    let application: Awaited<ReturnType<typeof launcher.launch>> | undefined;
    const platform = createPlatformAdapter({
        platform: 'win32',
        requestWindowsClose: launcher.requestNormalClose,
        waitWindowsExit: launcher.waitForExit,
        snapshot: async (pid, port) => {
            assert.equal(pid, 1601);
            assert.equal(port, 19333);
            return {
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    sessionId: 41,
                    startedAtUtc: nativeIdentity.startedAtUtc,
                },
                currentSessionId: 41,
                processIds: [1601],
                listeners: listenerPresent ? [{ localAddress: '127.0.0.1', owningProcess: 1601 }] : [],
            };
        },
    });
    const host = createTargetHost({
        platformAdapter: { ...platform, reservedRanges: async () => [] },
        probe: async () => true,
        now: () => Date.parse('2026-10-12T00:59:59.000Z'),
        spawn: async (executablePath, arguments_, _port, cwd, env, context) => {
            application = await launcher.launch(
                {
                    executablePath,
                    arguments: arguments_,
                    cwd: cwd ?? parent,
                    env: Object.fromEntries(
                        Object.entries(env ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
                    ),
                },
                {
                    ...context,
                    onCreated: (child) => {
                        application = child;
                        child.on('exit', () => order.push('application-exit'));
                        context?.onCreated?.(child);
                    },
                },
            );
            return application;
        },
        getVersion: async (port) => ({
            Browser: 'Fixture/1.0',
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/native-close-runtime`,
        }),
    });
    const tools = [{ name: 'list_pages', inputSchema: { type: 'object' as const, properties: {} } }];
    const directories = new DataDirectoryRegistry();
    const runtime = await createCoreFixture({
        dataDirectories: directories,
        profileAvailable: async () => true,
        createHost: () => host,
        loadCatalog: async () =>
            createToolCatalog({ version: '1.11.0', tools: [{ name: 'list_pages', requires: {}, variants: tools }] }),
        createRouter: async () => {
            const catalog = ++routerCount === 1;
            return {
                url: 'http://127.0.0.1:19334',
                setTarget: () => {},
                clearTarget: () => {
                    if (!catalog) order.push('route-revoked');
                },
                pause: () => {},
                resume: () => {},
                isBusy: () => false,
                close: async () => {
                    if (!catalog) order.push('router-disposed');
                },
            };
        },
        createConnection: async (_url, options) => {
            const catalog = ++connectionCount === 1;
            const upstream = {
                tools,
                call: async () => {
                    officialCalls++;
                    return { content: [] };
                },
                rootsChanged: async () => {},
                onExit: () => {},
                close: async () => {
                    if (catalog) return;
                    order.push('upstream-disposing');
                    upstreamDisposing.resolve();
                    await upstreamDisposal.promise;
                    order.push('upstream-disposed');
                },
            };
            options?.onAcquired?.(upstream);
            return upstream;
        },
    });
    const control = (request: ControlRequest, signal?: AbortSignal) => runtime.control(request, signal);
    const readControl = async (request: Record<string, unknown>, signal?: AbortSignal) => {
        const result = await control(parseControlRequest(request), signal);
        assert.ok(result);
        return result;
    };
    const launchResourcesClosed = () => {
        helpers[0]?.emit({ event: 'resources-closed', ...nativeIdentity, activeProcesses: 0 });
    };
    const launchObserverExit = (resourcesClosed = true) => {
        helpers[0]?.emit({ event: 'exited', processId: 1601, exitCode: 0 });
        if (resourcesClosed) launchResourcesClosed();
    };
    t.after(async () => {
        upstreamDisposal.resolve();
        launchObserverExit();
        await runtime.cleanup();
        for (const helper of helpers) {
            helper.child.stdin.end();
            helper.child.stdout.destroy();
            helper.child.stderr.destroy();
        }
        await rm(parent, { recursive: true, force: true });
    });
    const current = await runtime.controller.start(
        {
            launch: { executable: process.execPath, args: ['--data={dataDir}'] },
            isolation: {
                mode: 'data-dir',
                directory: { kind: 'new', parent, name: 'profile' },
                cleanup: 'delete-on-release',
            },
            basePort: 19333,
        },
        {
            onIsolation: (value) => {
                isolation.push(value);
                if (value.mode === 'data-dir' && value.state === 'deleted') deleted.resolve();
            },
        },
    );
    assert.ok(current.sessionId);
    assert.ok(application);
    const nativeApplication = application;
    await writeFile(path.join(profile, 'owned-marker'), 'retained until root exit and resource release');
    const route = { connectionId: current.connectionId, sessionId: current.sessionId };
    return {
        runtime,
        current,
        route,
        profile,
        directories,
        application: nativeApplication,
        requests,
        helpers,
        order,
        readControl,
        close: (requestId: string) => readControl({ action: 'stop', ...route, requestId, disposition: 'Close' }),
        operation: (operationId: string) => readControl({ action: 'status', operationId }),
        accepted: accepted.promise,
        upstreamDisposing: upstreamDisposing.promise,
        allowDisposal: upstreamDisposal.resolve,
        deleted: deleted.promise,
        launchObserverExit,
        launchResourcesClosed,
        operations: runtime.core.admin.operations,
        isolation: () => isolation.at(-1),
        listenerPresent: () => listenerPresent,
        officialCalls: () => officialCalls,
        directoryExists: async () => (await lstat(profile)).isDirectory(),
        invoke: (connection: ConnectionStatus = current) =>
            runtime.invoke(
                'list_pages',
                { _dct: { connectionId: connection.connectionId, sessionId: connection.sessionId } },
                new AbortController().signal,
                () => {},
            ),
        emitClose: (receipt: Record<string, unknown> = {}) => {
            assert.ok(helpers[1]);
            helpers[1].emit({
                event: 'closed',
                ...nativeIdentity,
                closed: true,
                closeRequested: true,
                processExited: true,
                waitResult: 0,
                waitError: 0,
                exitCode: 0,
                ...receipt,
            });
        },
    };
}

export type NativeCloseRuntime = Awaited<ReturnType<typeof nativeCloseRuntime>>;
