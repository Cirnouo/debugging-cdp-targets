import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createPlatformAdapter, validateProcessIdentity } from '../../src/adapters/platform-process.ts';
import { createWindowsLauncher } from '../../src/adapters/windows-launch.ts';
import { type ProcessEvidence, type ProcessTarget, validateCdpIdentity } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus } from '../../src/domains/control-contract.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import {
    type ApplicationProbeAdapter,
    type ApplicationProbeConfig,
    cleanupApplicationResources,
    type PayloadIO,
} from './application-screenshot-core.ts';
import {
    applicationScreenshotBrowserConfiguration,
    applicationScreenshotGatewayEnvironment,
} from './application-screenshot-fixture.ts';
import {
    applicationIdentityArguments,
    qualifyApplicationBrowserArguments,
    readApplicationProcessEvidence,
    runApplicationPowerShell,
    startApplicationExitWitness,
} from './application-screenshot-native.ts';
import { closeSmokeConnection, lifecycleClient, readConnection, readStatus } from './lifecycle-client.ts';
import { createClient, type McpRequestInterval } from './mcp-client.ts';
import { createScreenshotBackgroundAnchor } from './screenshot-background-anchor.ts';
import { createScreenshotCaptureObserver } from './screenshot-capture-observer.ts';
import type { WindowIdentity } from './window-evidence.ts';
export interface ApplicationAdapterClient {
    child: { pid?: number | undefined; spawnargs: string[]; exitCode: number | null; signalCode: string | null };
    request(
        method: string,
        params?: Record<string, unknown>,
        timeout?: number,
        interval?: McpRequestInterval,
    ): Promise<unknown>;
    notify(method: string): void;
    close(): Promise<void>;
}
export interface ApplicationAdapterIO {
    environment: Record<string, string | undefined>;
    now(): number;
    client(entry: string, options: { cwd: string; env: Record<string, string> }): ApplicationAdapterClient;
    snapshot(pid: number, port: number): Promise<ProcessEvidence>;
    endpoint(port: number): Promise<unknown>;
    powershell(
        script: string,
        args: string[],
        signal?: AbortSignal,
    ): Promise<{ raw: unknown; stdout: string; stderr: string }>;
    witness(
        identities: WindowIdentity[],
        record: (kind: string, value: unknown) => Promise<void>,
    ): { armed: Promise<void>; finish(): Promise<unknown> };
    anchor?: {
        prepare(identity: WindowIdentity, handle: number): Promise<unknown>;
        observe(identity: WindowIdentity, handle: number, signal?: AbortSignal): Promise<unknown>;
        cleanup(): Promise<unknown>;
    };
}
export const applicationPayloadIO: PayloadIO = {
    async listFiles(root) {
        const canonical = await realpath(root);
        assert.equal(
            path.normalize(canonical).toLowerCase(),
            path.normalize(root).toLowerCase(),
            'Sealed root contains an alias or reparse escape.',
        );
        const files: string[] = [];
        const visit = async (directory: string) => {
            assert.equal((await lstat(directory)).isSymbolicLink(), false, 'Linked sealed directory.');
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                const file = path.join(directory, entry.name);
                assert.equal(entry.isSymbolicLink(), false, 'Linked sealed file.');
                if (entry.isDirectory()) await visit(file);
                else {
                    assert.equal(entry.isFile(), true, 'Nonregular sealed file.');
                    files.push(path.relative(root, file).replaceAll('\\', '/'));
                }
            }
        };
        await visit(root);
        return files;
    },
    async readFile(file) {
        const before = await lstat(file, { bigint: true });
        assert.ok(before.isFile() && !before.isSymbolicLink());
        const bytes = await readFile(file);
        const after = await lstat(file, { bigint: true });
        assert.ok(
            after.isFile() &&
                before.dev === after.dev &&
                before.ino === after.ino &&
                before.size === after.size &&
                before.mtimeNs === after.mtimeNs &&
                before.ctimeNs === after.ctimeNs,
            'Sealed file identity changed while reading.',
        );
        return bytes;
    },
};

function nativeIO(): ApplicationAdapterIO {
    const platform = createPlatformAdapter();
    return {
        environment: process.env,
        now: Date.now,
        client: (entry, options) => createClient(entry, options),
        snapshot: (pid, port) => platform.snapshot(pid, port),
        async endpoint(port) {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(5000),
            });
            assert.ok(response.ok, 'Owned browser endpoint did not respond.');
            return response.json() as Promise<unknown>;
        },
        powershell: runApplicationPowerShell,
        witness: startApplicationExitWitness,
    };
}

export function createApplicationScreenshotAdapter(
    config: ApplicationProbeConfig,
    folder: string,
    record: (kind: string, value: unknown) => Promise<void>,
    io = nativeIO(),
): ApplicationProbeAdapter {
    let client: ApplicationAdapterClient | undefined;
    let entryId = '';
    let identity: ProcessTarget | undefined;
    let launchedAt = 0;
    let startAttempted = false;
    let launchedExecutable: string | undefined;
    let distinctBrowser = false;
    let backgroundPrepared = false;
    let anchorIdentity: WindowIdentity | undefined;
    const cancelledPermissionOperations = new Set<string>();
    const cancellationFailures: string[] = [];
    const owned = new Map<
        string,
        {
            connection: ConnectionStatus;
            identity?: ProcessTarget;
            browsers: WindowIdentity[];
            witness?: ReturnType<ApplicationAdapterIO['witness']>;
            witnessArmError?: string;
        }
    >();
    const retain = (raw: unknown) => {
        if (!isRecord(raw)) return;
        if (Array.isArray(raw.connections)) {
            for (const connection of raw.connections) retain(connection);
            return;
        }
        if (isRecord(raw.operation)) {
            if (isRecord(raw.operation.result)) retain(raw.operation.result);
            if (typeof raw.operation.connectionId === 'string' && typeof raw.operation.sessionId === 'string') {
                retain({
                    entryId: raw.operation.entryId ?? entryId,
                    connectionId: raw.operation.connectionId,
                    sessionId: raw.operation.sessionId,
                    status: 'starting',
                    targetKind: 'generic-cdp',
                });
            }
        }
        if (typeof raw.connectionId !== 'string' || typeof raw.entryId !== 'string' || typeof raw.status !== 'string')
            return;
        const connection = readConnection(raw);
        if (!connection.sessionId && !connection.processId) return;
        const key = `${connection.connectionId}/${connection.sessionId ?? 'unavailable'}`;
        const prior = owned.get(key);
        if (!prior) owned.set(key, { connection, browsers: [] });
        else {
            if (prior.connection.processId === undefined && connection.processId !== undefined)
                prior.connection.processId = connection.processId;
            if (prior.connection.port === undefined && connection.port !== undefined)
                prior.connection.port = connection.port;
        }
        // Never replace the previously acquired process/session tuple with projected status.
    };
    const tool = async (
        name: string,
        args: Record<string, unknown> = {},
        interval?: McpRequestInterval,
    ): Promise<Record<string, unknown>> => {
        assert.ok(client);
        await record('mcp-request', { name, arguments: args, timeoutMs: 90_000 });
        try {
            const result = await client.request('tools/call', { name, arguments: args }, 90_000, interval);
            let retentionError: unknown;
            if (isRecord(result)) {
                try {
                    retain(result.structuredContent);
                } catch (error) {
                    retentionError = error;
                }
            }
            await record('mcp-result', { name, result });
            assert.ok(isRecord(result));
            if (retentionError !== undefined) throw retentionError;
            const raw = result.structuredContent;
            if (name === 'dct_operation_wait' && isRecord(raw) && isRecord(raw.operation)) {
                const operation = raw.operation;
                const phases = [
                    operation.phase,
                    ...(Array.isArray(raw.events) ? raw.events.filter(isRecord).map((event) => event.phase) : []),
                ];
                const permission =
                    phases.some((phase) => phase === 'awaiting-permission' || phase === 'permission-handshake') ||
                    (isRecord(operation.error) && operation.error.nativeError === 740);
                if (permission && typeof operation.operationId !== 'string') {
                    cancellationFailures.push('Permission attempt has no valid cancellable operation identity.');
                    throw new Error(
                        'Unexpected permission waiting has no valid operation identity; cleanup remains uncertain.',
                    );
                }
                if (
                    permission &&
                    typeof operation.operationId === 'string' &&
                    !cancelledPermissionOperations.has(operation.operationId)
                ) {
                    cancelledPermissionOperations.add(operation.operationId);
                    await record('permission-attempt-blocked', {
                        operation,
                        phases,
                        action: 'cancel existing operation; no authorization or readiness continuation',
                    });
                    try {
                        const cancelled = (
                            await tool('dct_operation_cancel', { entryId, operationId: operation.operationId })
                        ).structuredContent;
                        assert.ok(isRecord(cancelled));
                        if (!['succeeded', 'failed', 'cancelled'].includes(String(cancelled.state))) {
                            const settlement = (
                                await tool('dct_operation_wait', {
                                    entryId,
                                    operationId: operation.operationId,
                                    cursor: typeof cancelled.cursor === 'number' ? cancelled.cursor : 0,
                                })
                            ).structuredContent;
                            assert.ok(
                                isRecord(settlement) && settlement.complete === true,
                                'Permission attempt cancellation has not settled.',
                            );
                        }
                    } catch (error) {
                        cancellationFailures.push(errorMessage(error));
                        await record('permission-cancel-uncertain', {
                            operationId: operation.operationId,
                            error: errorMessage(error),
                        });
                    }
                    throw new Error(
                        'Unexpected permission waiting or elevation fallback blocked this application attempt.',
                    );
                }
            }
            return result;
        } catch (error) {
            await record('mcp-error', { name, error: errorMessage(error) });
            throw error;
        }
    };
    const lifecycleTool = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await tool(name, args);
        assert.notEqual(result.isError, true, 'Lifecycle request failed; raw receipt retained.');
        return result;
    };
    const control = lifecycleClient(lifecycleTool);
    const sampleOwned = async (selected: WindowIdentity, state: string, handle?: number, signal?: AbortSignal) => {
        const output = await io.powershell(
            './windows-window-evidence.ps1',
            [
                ...applicationIdentityArguments(selected),
                '-State',
                state,
                ...(handle === undefined ? [] : ['-WindowHandle', String(handle)]),
            ],
            signal,
        );
        await record('native-sampler-output', output);
        const titles = await io.powershell(
            './windows-application-evidence.ps1',
            ['-Mode', 'Titles', ...applicationIdentityArguments(selected)],
            signal,
        );
        await record('native-titles-output', titles);
        assert.ok(Array.isArray(output.raw) && Array.isArray(titles.raw));
        const titleMap = new Map(
            titles.raw.filter(isRecord).map((item) => {
                assert.ok(typeof item.handle === 'number' && typeof item.title === 'string');
                return [item.handle, item.title];
            }),
        );
        return output.raw.map((item: unknown) => {
            assert.ok(isRecord(item));
            return { ...item, title: titleMap.get(Number(item.handle)) };
        });
    };
    const markers = new Map<number, string>();
    const launcher = createWindowsLauncher();
    const anchor =
        io.anchor ??
        createScreenshotBackgroundAnchor({
            async launch(bounds) {
                const executable = path.join(folder, 'background-anchor.exe');
                await record(
                    'anchor-compilation',
                    await io.powershell('../fixtures/compile-native-window.ps1', ['-Output', executable]),
                );
                const marker = path.join(folder, 'background-anchor-shown');
                const child = await launcher.launch({
                    executablePath: executable,
                    arguments: [marker],
                    cwd: folder,
                    env: {
                        SystemRoot: io.environment.SystemRoot ?? 'C:/Windows',
                        DCT_TEST_WINDOW_X: String(bounds.x),
                        DCT_TEST_WINDOW_Y: String(bounds.y),
                        DCT_TEST_WINDOW_WIDTH: String(bounds.width),
                        DCT_TEST_WINDOW_HEIGHT: String(bounds.height),
                        DCT_TEST_WINDOW_TITLE: 'DCT private application screenshot anchor',
                        DCT_TEST_WINDOW_NO_EXPIRY: 'true',
                    },
                });
                markers.set(child.pid, marker);
                anchorIdentity = { processId: child.pid, executablePath: executable, startedAtUtc: child.startedAtUtc };
                return anchorIdentity;
            },
            async sample(selected, handle, signal) {
                const marker = markers.get(selected.processId);
                if (marker && handle === undefined) {
                    const deadline = io.now() + 8000;
                    for (;;) {
                        try {
                            await readFile(marker);
                            break;
                        } catch (error) {
                            if (io.now() >= deadline) throw error;
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                    }
                }
                return sampleOwned(selected, 'None', handle, signal);
            },
            foreground: (selected, handle) => sampleOwned(selected, 'Foreground', handle),
            background: (selected, handle) => sampleOwned(selected, 'Background', handle),
            close: (selected) => launcher.close({ ...selected, targetKind: 'generic-cdp', port: 0 }),
            record,
        });
    const nativeSample = async (handle?: number, signal?: AbortSignal) => {
        assert.ok(identity);
        return backgroundPrepared && handle !== undefined
            ? anchor.observe(identity, handle, signal)
            : sampleOwned(identity, 'None', handle, signal);
    };
    const establishIdentity = async (resource: NonNullable<ReturnType<typeof owned.get>>, executable: string) => {
        assert.ok(resource.connection.processId && resource.connection.port);
        const snapshot = await io.snapshot(resource.connection.processId, resource.connection.port);
        await record('process-listener-snapshot', snapshot);
        assert.ok(snapshot.root.exists, 'New owned root is unavailable.');
        const selected: ProcessTarget = {
            processId: resource.connection.processId,
            port: resource.connection.port,
            targetKind: 'generic-cdp',
            executablePath: executable,
            startedAtUtc: snapshot.root.startedAtUtc,
        };
        // Retain the observed tuple before validating subsequent listener/endpoint evidence.
        resource.identity = selected;
        validateProcessIdentity(snapshot, selected);
        assert.ok(
            Date.parse(selected.startedAtUtc) >= launchedAt - 1000 && Date.parse(selected.startedAtUtc) <= io.now(),
            'Root does not belong to this acquisition.',
        );
        const endpoint = await io.endpoint(selected.port);
        validateCdpIdentity({
            endpoint,
            port: selected.port,
            listeners: snapshot.listeners,
            processIds: snapshot.processIds,
            targetKind: 'generic-cdp',
        });
        await record('verified-target', { identity: selected, endpoint });
        const owners = [...new Set(snapshot.listeners.map((listener) => listener.owningProcess))];
        assert.equal(owners.length, 1, 'Owned browser listener identity is ambiguous.');
        if (distinctBrowser)
            assert.notEqual(
                owners[0],
                selected.processId,
                'Tauri browser listener must be a distinct owned descendant.',
            );
        for (const processId of owners) {
            assert.ok(snapshot.processIds.includes(processId));
            const owner = processId === selected.processId ? snapshot : await io.snapshot(processId, selected.port);
            assert.ok(owner.root.exists);
            const browser = {
                processId,
                executablePath: owner.root.executablePath,
                startedAtUtc: owner.root.startedAtUtc,
            };
            validateProcessIdentity(owner, { ...browser, targetKind: 'generic-cdp' });
            assert.ok(
                Date.parse(browser.startedAtUtc) >= Date.parse(selected.startedAtUtc) &&
                    Date.parse(browser.startedAtUtc) <= io.now(),
                'Browser listener does not belong to this acquisition.',
            );
            resource.browsers.push(browser);
        }
        return selected;
    };
    return {
        payloadIO: applicationPayloadIO,
        inheritedEnvironment: applicationScreenshotGatewayEnvironment(io.environment),
        record,
        async acquire(prepared, payload) {
            assert.ok(!client, 'One fresh application gateway per adapter.');
            assert.equal(config.preflight.status, 'approved', 'Blocked preflight cannot acquire.');
            assert.notEqual(
                prepared.fixture.application,
                'readest',
                'Selected Readest candidate is blocked before acquisition.',
            );
            const env = applicationScreenshotGatewayEnvironment(io.environment);
            client = io.client(path.join(payload.root, 'dist/mcp-bootstrap.mjs'), { cwd: prepared.directory, env });
            await record('gateway-process', { pid: client.child.pid, entry: client.child.spawnargs, payload });
            const initialization = {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'application-screenshot-probe', version: '0.1.0' },
            };
            await record('mcp-initialize-request', initialization);
            await record('mcp-initialize-result', await client.request('initialize', initialization));
            client.notify('notifications/initialized');
            const initial = readStatus((await lifecycleTool('dct_connection_status')).structuredContent);
            entryId = initial.entryId;
            assert.ok(
                'connections' in initial && initial.connections.length === 0,
                'Fresh gateway has existing connections.',
            );
            launchedAt = io.now();
            launchedExecutable = prepared.launch.executable;
            distinctBrowser = prepared.fixture.application === 'tauri-fixture';
            startAttempted = true;
            const connection = await control({
                isolation: { mode: 'none' },
                action: 'start',
                entryId,
                requestId: randomUUID(),
                targetKind: 'generic-cdp',
                launch: prepared.launch,
                basePort: 20222,
                mcpArgs: ['--workspace', prepared.directory],
            });
            assert.ok(
                !('connections' in connection) && connection.sessionId && connection.processId && connection.port,
            );
            retain(connection);
            const resource = owned.get(`${connection.connectionId}/${connection.sessionId}`);
            assert.ok(resource);
            identity = await establishIdentity(resource, prepared.launch.executable);
            const names = ['list_pages', 'evaluate_script', 'take_screenshot'];
            const schemas = (
                await lifecycleTool('dct_connection_status', {
                    entryId,
                    connectionId: connection.connectionId,
                    toolNames: names,
                })
            ).structuredContent;
            await record('selected-tool-schemas', schemas);
            assert.ok(isRecord(schemas) && Array.isArray(schemas.toolAvailability));
            for (const name of names)
                assert.ok(
                    schemas.toolAvailability
                        .filter(isRecord)
                        .some((item) => item.name === name && isRecord(item.inputSchema)),
                    'Missing selected official tool schema.',
                );
            const routing = { connectionId: connection.connectionId, sessionId: connection.sessionId };
            await record('routing', { entryId, ...routing });
            const selectedIdentity = identity;
            return {
                identity,
                async qualify() {
                    const browserConfiguration = applicationScreenshotBrowserConfiguration(
                        prepared.fixture.application,
                        prepared.launch,
                    );
                    const profile =
                        prepared.fixture.application === 'tauri-fixture'
                            ? prepared.launch.env?.WEBVIEW2_USER_DATA_FOLDER
                            : browserConfiguration.browserArguments
                                  .find((arg) => arg.startsWith('--user-data-dir='))
                                  ?.slice('--user-data-dir='.length);
                    assert.ok(profile, 'Reviewed expanded profile carrier is unavailable.');
                    const evidence = [];
                    const processes = [
                        selectedIdentity,
                        ...resource.browsers.filter((browser) => browser.processId !== selectedIdentity.processId),
                    ];
                    for (const browser of processes) {
                        const output = await io.powershell('./windows-application-evidence.ps1', [
                            '-Mode',
                            'Inspect',
                            ...applicationIdentityArguments(browser),
                        ]);
                        await record('browser-process-output', output);
                        const actual = readApplicationProcessEvidence(output.raw, browser);
                        assert.equal(actual.elevated, false, 'Application requires observed ordinary privileges.');
                        if (browser.processId === selectedIdentity.processId) {
                            assert.equal(
                                actual.file.sha256,
                                prepared.sourceSha256,
                                'Actual executable bytes differ from reviewed source.',
                            );
                            assert.equal(
                                actual.file.sha256,
                                prepared.fixture.source.sha256,
                                'Actual copied executable differs from fixture source.',
                            );
                        }
                        if (
                            prepared.fixture.application !== 'tauri-fixture' ||
                            browser.processId !== selectedIdentity.processId
                        )
                            qualifyApplicationBrowserArguments(actual, {
                                application: prepared.fixture.application,
                                profile,
                                port: selectedIdentity.port,
                                candidate: browserConfiguration.screenshotFeatureEnabled,
                            });
                        evidence.push(actual);
                    }
                    const snapshot = await io.snapshot(selectedIdentity.processId, selectedIdentity.port);
                    validateProcessIdentity(snapshot, selectedIdentity);
                    const endpoint = await io.endpoint(selectedIdentity.port);
                    validateCdpIdentity({
                        endpoint,
                        port: selectedIdentity.port,
                        listeners: snapshot.listeners,
                        processIds: snapshot.processIds,
                        targetKind: 'generic-cdp',
                    });
                    assert.deepEqual(
                        [...new Set(snapshot.listeners.map((listener) => listener.owningProcess))].sort(),
                        resource.browsers.map((browser) => browser.processId).sort(),
                    );
                    return {
                        evidence,
                        snapshot,
                        endpoint,
                        basis: 'Identity-bound actual browser argv and executable versions; internal FeatureList is unobserved.',
                    };
                },
                call: (name, args, interval) => tool(name, { ...args, _dct: routing }, interval),
                status: () =>
                    lifecycleTool('dct_connection_status', {
                        entryId,
                        connectionId: connection.connectionId,
                        include: ['diagnostics'],
                    }),
                sample: nativeSample,
                async condition(condition, handle) {
                    if (condition === 'background-normal') {
                        const raw = await anchor.prepare(selectedIdentity, handle);
                        backgroundPrepared = true;
                        return raw;
                    }
                    return sampleOwned(
                        selectedIdentity,
                        condition === 'foreground-normal' ? 'Foreground' : 'Minimize',
                        handle,
                    );
                },
                capture: createScreenshotCaptureObserver({ sample: nativeSample, tabs: async () => {}, record }),
                async png(file, points) {
                    const bytes = await readFile(file);
                    const primary = {
                        filePath: file,
                        sha256: createHash('sha256').update(bytes).digest('hex'),
                        bytes: bytes.length,
                    };
                    await record('png-file', primary);
                    const output = await io.powershell('./windows-png-evidence.ps1', [
                        '-ImagePath',
                        file,
                        '-Points',
                        points.map((point) => `${point.x},${point.y}`).join(';'),
                    ]);
                    await record('png-decoder-output', output);
                    return {
                        ...primary,
                        decoded: output.raw,
                    };
                },
            };
        },
        async cleanup() {
            if (!client) {
                await anchor.cleanup();
                return { ok: true, gatewayNotAcquired: true };
            }
            const discoveryFailures: string[] = [...cancellationFailures];
            try {
                const status = readStatus(
                    (await lifecycleTool('dct_connection_status', entryId ? { entryId } : {})).structuredContent,
                );
                entryId = status.entryId;
                assert.ok('connections' in status);
                for (const connection of status.connections) retain(connection);
            } catch (error) {
                discoveryFailures.push(`Discovery: ${errorMessage(error)}`);
            }
            const resources = [...owned.values()];
            if (startAttempted && resources.length === 0)
                discoveryFailures.push('Attempted start has no complete owned identity.');
            const cleanup = await cleanupApplicationResources({
                connections: resources,
                async close(resource) {
                    try {
                        if (!resource.identity) {
                            assert.ok(launchedExecutable, 'Exact attempted launch executable is unavailable.');
                            await establishIdentity(resource, launchedExecutable);
                        }
                        assert.ok(resource.identity);
                        const identities = [
                            resource.identity,
                            ...resource.browsers.filter(
                                (browser) => browser.processId !== resource.identity?.processId,
                            ),
                        ];
                        resource.witness = io.witness(identities, record);
                        await resource.witness.armed;
                    } catch (error) {
                        resource.witnessArmError = errorMessage(error);
                        await record('exit-witness-arm-error', {
                            connection: resource.connection,
                            error: resource.witnessArmError,
                        });
                    }
                    assert.ok(resource.connection.sessionId);
                    const receipt = await closeSmokeConnection(control, {
                        action: 'stop',
                        entryId,
                        connectionId: resource.connection.connectionId,
                        sessionId: resource.connection.sessionId,
                        requestId: randomUUID(),
                        disposition: 'Close',
                    });
                    await record('normal-close-receipt', { connection: resource.connection, receipt });
                    return receipt;
                },
                async witness(resource) {
                    assert.ok(resource.witness && !resource.witnessArmError, 'Actual exit witness could not be armed.');
                    const raw = await resource.witness.finish();
                    await record('actual-exit-witness', { connection: resource.connection, raw });
                    assert.ok(isRecord(raw) && Array.isArray(raw.receipts));
                    const expected = [
                        resource.identity,
                        ...resource.browsers.filter((browser) => browser.processId !== resource.identity?.processId),
                    ];
                    assert.equal(raw.receipts.length, expected.length);
                    for (const [index, receipt] of raw.receipts.entries()) {
                        assert.ok(isRecord(receipt));
                        const ownedIdentity = expected[index];
                        assert.ok(ownedIdentity);
                        assert.equal(receipt.processId, ownedIdentity.processId);
                        assert.equal(receipt.startedAtUtc, ownedIdentity.startedAtUtc);
                        assert.equal(receipt.executablePath, ownedIdentity.executablePath);
                        assert.ok(
                            receipt.processExited === true &&
                                receipt.identityVerified === true &&
                                receipt.waitResult === 0 &&
                                receipt.waitError === 0 &&
                                typeof receipt.exitCode === 'number',
                        );
                    }
                    assert.ok(resource.identity);
                    const after = await io.snapshot(resource.identity.processId, resource.identity.port);
                    await record('owned-process-listener-after', {
                        identity: resource.identity,
                        browsers: resource.browsers,
                        snapshot: after,
                    });
                    assert.equal(
                        after.root.exists,
                        false,
                        'Root PID is present after witnessed exit (including reuse).',
                    );
                    assert.equal(after.listeners.length, 0, 'Owned port still has a listener.');
                    return { processExited: true, identityVerified: true, waitResult: 0, waitError: 0, exitCode: 0 };
                },
                anchor: () => anchor.cleanup(),
                async final() {
                    const final = readStatus(
                        (await lifecycleTool('dct_connection_status', { entryId })).structuredContent,
                    );
                    await record('final-status', final);
                    if (discoveryFailures.length > 0) throw new Error(discoveryFailures.join('; '));
                    return final;
                },
                async shutdown() {
                    assert.ok(client);
                    await client.close();
                    const exit = { code: client.child.exitCode, signal: client.child.signalCode };
                    await record('gateway-exit', exit);
                    return exit;
                },
            });
            if (!cleanup.ok)
                return {
                    ...cleanup,
                    retained: {
                        gateway: {
                            pid: client.child.pid,
                            entryId,
                            stdioOpen: client.child.exitCode === null && client.child.signalCode === null,
                        },
                        connections: resources.map((resource) => resource.connection),
                        processes: [
                            ...resources.flatMap((resource) => [
                                ...(resource.identity ? [resource.identity] : []),
                                ...resource.browsers,
                            ]),
                            ...(anchorIdentity ? [anchorIdentity] : []),
                        ],
                        evidenceDirectory: folder,
                    },
                };
            return cleanup;
        },
    };
}
