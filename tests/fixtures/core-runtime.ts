import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Progress } from '@modelcontextprotocol/client';
import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import type { OfficialConnection } from '../../src/adapters/mcp-bridge.ts';
import { createToolCatalog } from '../../src/adapters/tool-catalog.ts';
import type {
    ConnectionStatus,
    ControlContext,
    ControlHandler,
    CoreControlHandler,
    CoreControlRequest,
    LaunchOptions,
} from '../../src/domains/control-contract.ts';
import { createGatewayCore, type GatewayDependencies } from '../../src/gateway/core.ts';
import { RetainedTargetError } from '../../src/gateway/targets/model/target-contract.ts';
import type { ClientRequestFacilities } from '../../src/shared/client-context.ts';

/** Test composition over the real core, with one explicit authenticated client. */
export async function createCoreFixture(
    dependencies: GatewayDependencies = {},
    facilities: Omit<Partial<ClientRequestFacilities>, 'requestId' | 'waitSignal'> = {},
) {
    const core = await createGatewayCore(dependencies);
    const registration = core.register();
    const client = core.attachClient(registration.bearer);
    let sequence = 0;
    function request(overrides: Partial<ClientRequestFacilities> = {}) {
        return client.request({
            requestId: ++sequence,
            capabilities: { roots: false, formElicitation: false },
            ...facilities,
            ...overrides,
        });
    }
    const context = (value: ControlContext = {}): ControlContext => ({
        ...value,
        client: request(value.signal ? { waitSignal: value.signal } : {}),
    });
    const controller: CoreControlHandler = {
        status: core.controller.status,
        start: (options, value) => core.controller.start(options, context(value)),
        restart: (route, value) => core.controller.restart(route, context(value)),
        stop: (route, value) => core.controller.stop(route, context(value)),
    };
    return {
        core,
        registration,
        client,
        request,
        controller,
        control: (value: CoreControlRequest, signal?: AbortSignal) =>
            core.control(value, request(signal ? { waitSignal: signal } : {})),
        invoke: (
            name: string,
            args: Record<string, unknown>,
            signal?: AbortSignal,
            onProgress?: (progress: Progress) => void,
        ) =>
            core.invoke(
                name,
                args,
                request({ ...(signal ? { waitSignal: signal } : {}), ...(onProgress ? { onProgress } : {}) }),
            ),
        cleanup: core.cleanup,
    };
}

export function connectionStatus(controller: ControlHandler, connectionId: string): ConnectionStatus {
    const status = controller.status(connectionId);
    assert.ok('connectionId' in status);
    return status;
}

export async function createConnectionRuntimeFixture({
    failOfficialClose = false,
    failCloseUntil = 2,
    mismatchCatalog = false,
    failLaunch = '',
    retainLaunch = false,
    failTargetClose = false,
    waitForCancellation = false,
    timeoutCall = false,
} = {}) {
    let connections = 0;
    let closes = 0;
    let calls = 0;
    let routers = 0;
    let routerCloses = 0;
    const received: { url: string; arguments: Record<string, unknown> }[] = [];
    const launches: LaunchOptions[] = [];
    const exits: (() => void)[] = [];
    const targets: EventEmitter[] = [];
    let releaseLaunch: () => void = () => {};
    let targetCloses = 0;
    let targetCloseFails = failTargetClose;
    const runtime = await createCoreFixture({
        loadCatalog: async (tools = []) =>
            createToolCatalog({
                version: '1.11.0',
                tools: tools.map((tool) => ({ name: tool.name, requires: {}, variants: [tool] })),
            }),
        createRouter: async () => ({
            url: `http://127.0.0.1:${31000 + routers++}`,
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => {},
            close: async () => {
                routerCloses += 1;
            },
        }),
        createHost: () => ({
            launch: async (options, context) => {
                if (options.launch.executable === 'wait-cleanup') {
                    await new Promise<void>((resolve) => {
                        releaseLaunch = resolve;
                    });
                    context?.signal?.throwIfAborted();
                }
                if (waitForCancellation && context?.signal) {
                    const signal = context.signal;
                    if (!signal.aborted)
                        await new Promise<void>((resolve) =>
                            signal.addEventListener('abort', () => resolve(), { once: true }),
                        );
                    throw signal.reason;
                }
                launches.push(options);
                if (options.launch.executable === failLaunch && !retainLaunch) throw new Error('Launch failed.');
                const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null });
                targets.push(child);
                const target = {
                    processId: 42 + targets.length,
                    port: options.exactPort ?? 9222,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-02T00:00:00Z',
                    targetKind: 'chrome' as const,
                    child,
                    launchDefinition: {
                        executablePath: process.execPath,
                        arguments: ['--port=9222'],
                        cwd: process.cwd(),
                    },
                };
                context?.onCreated?.(target);
                if (options.launch.executable === failLaunch && retainLaunch)
                    throw new RetainedTargetError('Rollback failed.', target);
                return target;
            },
            close: async (target) => {
                targetCloses++;
                if (targetCloseFails) return false;
                const child = targets[target.processId - 43];
                assert.ok(child);
                Object.assign(child, { exitCode: 0 });
                child.emit('exit', 0);
                return true;
            },
        }),
        createConnection: async (url): Promise<OfficialConnection> => {
            connections += 1;
            return {
                tools: [
                    {
                        name: mismatchCatalog && connections > 1 ? 'changed_pages' : 'list_pages',
                        inputSchema: { type: 'object', properties: {} },
                    },
                ],
                call: async (_name, arguments_) => {
                    received.push({ url, arguments: arguments_ });
                    calls += 1;
                    if (timeoutCall && url.endsWith(':31001'))
                        throw new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out.');
                    return { content: [] };
                },
                close: async () => {
                    closes += 1;
                    if (failOfficialClose && closes >= 2 && closes <= failCloseUntil)
                        throw new Error('Official normal close timed out.');
                },
                onExit: (listener) => {
                    exits.push(listener);
                },
                rootsChanged: async () => {},
            };
        },
    });
    const controller = runtime.controller;
    assert.ok(runtime);
    return {
        runtime,
        controller,

        targets,
        exits,
        received,
        launches,
        routerCloses: () => routerCloses,
        counts: () => ({ connections, closes, calls }),
        releaseLaunch: () => releaseLaunch(),
        targetCloses: () => targetCloses,
        allowTargetClose: () => {
            targetCloseFails = false;
        },
    };
}
