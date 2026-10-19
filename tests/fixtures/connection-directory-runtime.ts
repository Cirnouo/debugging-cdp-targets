import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DataDirectoryRegistry } from '../../src/adapters/data-directory.ts';
import { createToolCatalog } from '../../src/adapters/tool-catalog.ts';
import type { ConnectionStatus, ControlContext, LaunchOptions } from '../../src/domains/control-contract.ts';
import type { DataIsolationEvidence } from '../../src/gateway/targets/model/isolation.ts';
import { resolveLaunchDefinition } from '../../src/gateway/targets/model/launch-command.ts';
import { createCoreFixture } from './core-runtime.ts';

export function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class Application extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;
    waitForResourcesClosed?: () => Promise<void>;
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

export async function createDirectoryRuntimeFixture(
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
        resources?: (index: number) => Promise<void>;
        expectCleanupFailure?: boolean;
    } = {},
) {
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-isolation-runtime-')));

    const launchEntered = deferred();
    const applications: Application[] = [];
    const launches: { options: LaunchOptions; directory?: string; arguments: string[] }[] = [];
    const disposal: string[] = [];
    const directories = options.directories ?? new DataDirectoryRegistry();
    const tools = [{ name: 'list_pages', inputSchema: { type: 'object' as const, properties: {} } }];
    let routers = 0;
    let upstreams = 0;
    let failClose = options.failClose ?? false;
    let failUpstreamClose = options.failUpstreamClose ?? false;
    const runtime = await createCoreFixture({
        dataDirectories: directories,
        ...(options.profileAvailable ? { profileAvailable: options.profileAvailable } : {}),
        loadCatalog: async () =>
            createToolCatalog({
                version: '1.11.0',
                tools: [{ name: 'list_pages', requires: {}, variants: tools }],
            }),
        createRouter: async () => {
            routers++;
            if (routers > 2) await options.replacementRouter;
            return {
                url: `http://127.0.0.1:${31000 + routers}`,
                setTarget: () => {},
                clearTarget: () => disposal.push('route-revoked'),
                isBusy: () => false,
                close: async () => {
                    disposal.push('router');
                },
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
                if (options.resources) {
                    const resources = options.resources(applications.length);
                    child.waitForResourcesClosed = () => {
                        disposal.push('target-resources');
                        return resources;
                    };
                }
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
                    if (!catalog) disposal.push('upstream');
                    if (!catalog && failUpstreamClose) throw new Error(`EACCES private path ${parent}`);
                },
            };
        },
    });
    assert.ok(runtime);
    assert.ok(runtime.control);
    const control = runtime.control;
    t.after(async () => {
        failClose = false;
        failUpstreamClose = false;
        for (const child of applications) if (child.exitCode === null) child.exit();
        if (options.expectCleanupFailure) await assert.rejects(runtime.cleanup(), /cleanup failed/);
        else await runtime.cleanup();
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
        directories,
        disposal,

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

export function route(connection: ConnectionStatus) {
    assert.ok(connection.sessionId);
    return { connectionId: connection.connectionId, sessionId: connection.sessionId };
}
