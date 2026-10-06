import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPlatformAdapter, validateProcessIdentity } from '../../src/adapters/platform-process.ts';
import { type ProcessTarget, validateCdpIdentity } from '../../src/domains/cdp-target.ts';
import type { ConnectionStatus } from '../../src/domains/control-contract.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient } from './mcp-client.ts';
import { closeEvery } from './screenshot-fixture.ts';
import {
    correlateNativeTabs,
    parseScreenshotTimeoutFixture,
    runScreenshotTimeoutProbe,
} from './screenshot-timeout-fixture.ts';
import { assertWindowState, readWindowSample } from './window-evidence.ts';

assert.equal(process.platform, 'win32', 'This opt-in native screenshot probe requires Windows.');
const configPath = process.argv[2];
const outputParent = process.argv[3];
assert.ok(
    configPath && outputParent && path.isAbsolute(configPath) && path.isAbsolute(outputParent),
    'Supply absolute fixture JSON and evidence parent paths.',
);
const fixture = parseScreenshotTimeoutFixture(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
await mkdir(outputParent, { recursive: true });
const folder = await mkdtemp(path.join(outputParent, `${fixture.label}-`));
await mkdir(path.join(folder, 'profile'));
await writeFile(path.join(folder, 'fixture.json'), `${JSON.stringify(fixture, null, 4)}\n`);
const root = fileURLToPath(new URL('../..', import.meta.url));
const platform = createPlatformAdapter();
const evidence: Record<string, unknown>[] = [];
const timestamp = () => ({ utc: new Date().toISOString(), monotonicMs: performance.now() });
const save = () => writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify({ fixture, evidence }, null, 4)}\n`);
let writing = Promise.resolve();
function record(kind: string, value: unknown) {
    const event = { kind, ...timestamp(), value };
    const pending = writing.then(async () => {
        evidence.push(event);
        if (kind === 'fixture-evaluation' && isRecord(value) && typeof value.index === 'number') {
            await writeFile(
                path.join(folder, `evaluation-${value.index + 1}.json`),
                `${JSON.stringify(value, null, 4)}\n`,
            );
        }
        await save();
        console.log(JSON.stringify({ kind, ...timestamp(), ...(kind === 'final' ? { result: value } : {}) }));
    });
    writing = pending.catch(() => {});
    return pending;
}
console.log(JSON.stringify({ kind: 'evidence-directory', folder, ...timestamp() }));
await record('observation-limits', {
    methodLevelFocusEmulationTiming: 'unavailable',
    actualCaptureScreenshotParams: 'unavailable',
    expectations:
        'Official focus emulation remains enabled; first capture omits format/quality. These are source/request expectations, not observed CDP method traffic.',
    diagnosticLimits:
        'Gateway diagnostics are bounded; absent phases or truncated ring entries do not establish that CDP capture was never sent.',
    nativeLimits:
        'IsWindowVisible and IsIconic do not establish compositor visibility or occlusion. Native tab evidence is independent of JavaScript focus/visibility.',
});

let client: ReturnType<typeof createClient> | undefined;
let entryId = '';
const owned: ConnectionStatus[] = [];
let identity: ProcessTarget | undefined;
let pageTitle: string | undefined;
const tool = async (name: string, args: Record<string, unknown> = {}) => {
    assert.ok(client);
    await record('mcp-request', { name, arguments: args, timeoutMs: 90_000 });
    try {
        const result = await client.request('tools/call', { name, arguments: args }, 90_000);
        assert.ok(isRecord(result), 'Invalid MCP tool result.');
        await record('mcp-result', { name, result });
        return result;
    } catch (error) {
        await record('mcp-error', { name, error: errorMessage(error) });
        throw error;
    }
};
const lifecycleTool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tool(name, args);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result;
};
const control = lifecycleClient(lifecycleTool);

async function powershell(script: string, args: string[], signal?: AbortSignal) {
    const output = await promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL(script, import.meta.url)),
            ...args,
        ],
        { windowsHide: true, shell: false, timeout: 10_000, ...(signal === undefined ? {} : { signal }) },
    );
    const raw: unknown = JSON.parse(output.stdout);
    return { raw, stdout: output.stdout, stderr: output.stderr };
}
async function nativeSample(handle?: number, signal?: AbortSignal) {
    assert.ok(identity);
    const output = await powershell(
        './windows-window-evidence.ps1',
        [
            '-ApplicationPid',
            String(identity.processId),
            '-ExecutablePath',
            identity.executablePath,
            '-StartedAtUtc',
            identity.startedAtUtc,
            '-State',
            'None',
            ...(handle === undefined ? [] : ['-WindowHandle', String(handle)]),
        ],
        signal,
    );
    await record('native-sampler-output', output);
    return output.raw;
}
async function nativeTabs(handle: number, signal?: AbortSignal) {
    assert.ok(identity);
    try {
        const output = await powershell(
            './windows-selected-tab-evidence.ps1',
            [
                '-ApplicationPid',
                String(identity.processId),
                '-ExecutablePath',
                identity.executablePath,
                '-StartedAtUtc',
                identity.startedAtUtc,
                '-WindowHandle',
                String(handle),
            ],
            signal,
        );
        await record('native-tab-output', output);
        await record('native-tab-correlation', {
            pageTitle,
            ...correlateNativeTabs(output.raw, pageTitle),
            basis: 'Read-only owned HWND accessibility selection; JavaScript hasFocus/visibilityState is not used.',
        });
    } catch (error) {
        await record('native-tab-error', { handle, error: errorMessage(error), correlation: 'unknown' });
    }
}

const result = await runScreenshotTimeoutProbe(fixture, path.join(folder, 'screenshot.png'), {
    record: async (kind, value) => {
        if (kind === 'metadata-observation' && isRecord(value) && Array.isArray(value.content)) {
            for (const content of value.content.filter(isRecord)) {
                if (typeof content.text !== 'string') continue;
                const json = content.text.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
                if (json) {
                    const metadata: unknown = JSON.parse(json);
                    if (isRecord(metadata) && typeof metadata.title === 'string') pageTitle = metadata.title;
                }
            }
        }
        await record(kind, value);
        if (kind === 'native-validated' && isRecord(value) && typeof value.handle === 'number') {
            await nativeTabs(value.handle);
        }
    },
    async acquire(selectedFixture) {
        client = createClient(path.join(root, 'plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
        await record('gateway-process', { pid: client.child.pid, entry: client.child.spawnargs });
        const initialization = {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'screenshot-timeout-probe', version: '0.1.0' },
        };
        await record('mcp-initialize-request', initialization);
        await record('mcp-initialize-result', await client.request('initialize', initialization));
        client.notify('notifications/initialized');
        await record('mcp-notification', { method: 'notifications/initialized' });
        const initial = readStatus((await lifecycleTool('dct_connection_status')).structuredContent);
        entryId = initial.entryId;
        assert.ok(
            'connections' in initial && initial.connections.length === 0,
            'Fresh gateway must have no connections.',
        );
        const launch = selectedFixture.launch;
        const started = Date.now();
        const connection = await control({
            action: 'start',
            entryId,
            requestId: randomUUID(),
            targetKind: 'chrome',
            launch,
            basePort: 20222,
            mcpArgs: ['--workspace', folder],
        });
        assert.ok(!('connections' in connection) && connection.sessionId && connection.processId && connection.port);
        owned.push(connection);
        await record('acquired-identities', { connection, launch, workspace: folder });
        try {
            const snapshot = await platform.snapshot(connection.processId, connection.port);
            await record('process-listener-snapshot', snapshot);
            assert.ok(snapshot.root.exists);
            assert.ok(
                Date.parse(snapshot.root.startedAtUtc) >= started - 1000 &&
                    Date.parse(snapshot.root.startedAtUtc) <= Date.now(),
            );
            identity = {
                processId: connection.processId,
                port: connection.port,
                targetKind: 'chrome',
                executablePath: launch.executable,
                startedAtUtc: snapshot.root.startedAtUtc,
            };
            validateProcessIdentity(snapshot, identity);
            const response = await fetch(`http://127.0.0.1:${identity.port}/json/version`, {
                signal: AbortSignal.timeout(5000),
            });
            assert.ok(response.ok);
            const endpoint: unknown = await response.json();
            validateCdpIdentity({
                endpoint,
                port: identity.port,
                listeners: snapshot.listeners,
                processIds: snapshot.processIds,
                targetKind: identity.targetKind,
            });
            await record('verified-target', { identity, endpoint });
        } catch (error) {
            throw Object.assign(new Error(errorMessage(error)), { probeOutcome: 'blocked-evidence' });
        }
        assert.ok(identity);
        const names = [
            'list_pages',
            'new_page',
            'emulate',
            'evaluate_script',
            'take_screenshot',
            ...(selectedFixture.bringToFront === undefined ? [] : ['select_page']),
        ];
        const schemas = (
            await lifecycleTool('dct_connection_status', {
                entryId,
                connectionId: connection.connectionId,
                toolNames: names,
            })
        ).structuredContent;
        await record('selected-tool-schemas', schemas);
        assert.ok(isRecord(schemas) && Array.isArray(schemas.toolAvailability));
        const tools = schemas.toolAvailability.filter(isRecord);
        for (const name of names)
            assert.ok(
                tools.some((item) => item.name === name && isRecord(item.inputSchema)),
                `Missing selected schema: ${name}`,
            );
        const routing = { connectionId: connection.connectionId, sessionId: connection.sessionId };
        await record('routing', { entryId, ...routing });
        return {
            identity,
            call: (name, args) => tool(name, { ...args, _dct: routing }),
            status: () =>
                lifecycleTool('dct_connection_status', {
                    entryId,
                    connectionId: connection.connectionId,
                    include: ['diagnostics'],
                }),
            sample: nativeSample,
            async capture(call, handle) {
                const abort = new AbortController();
                const startedAt = performance.now();
                let samplingFailure: string | undefined;
                const observer = (async () => {
                    // Bounded passive samples only; no CDP/upstream call is made by this loop.
                    for (
                        let count = 0;
                        count < 100 && performance.now() - startedAt < 95_000 && !abort.signal.aborted;
                        count += 1
                    ) {
                        try {
                            assert.ok(identity);
                            const raw = await nativeSample(handle, abort.signal);
                            const sampled = readWindowSample(raw, identity, handle);
                            assertWindowState(sampled, 'normal');
                            await record('passive-native-validated', sampled);
                            await nativeTabs(handle, abort.signal);
                        } catch (error) {
                            if (!abort.signal.aborted) samplingFailure = errorMessage(error);
                            await record('passive-native-error', {
                                error: errorMessage(error),
                                stopped: abort.signal.aborted,
                            });
                        }
                        if (!abort.signal.aborted)
                            await new Promise<void>((resolve) => {
                                const finish = () => {
                                    clearTimeout(timer);
                                    abort.signal.removeEventListener('abort', finish);
                                    resolve();
                                };
                                const timer = setTimeout(finish, 500);
                                abort.signal.addEventListener('abort', finish, { once: true });
                            });
                    }
                })();
                try {
                    return await call();
                } finally {
                    abort.abort();
                    await observer;
                    await record('passive-observer-stopped', {
                        elapsedMs: performance.now() - startedAt,
                        samplingFailure,
                    });
                }
            },
            async png(filePath) {
                const bytes = await readFile(filePath);
                const decoded = await powershell('./windows-png-evidence.ps1', [
                    '-ImagePath',
                    filePath,
                    '-Points',
                    '0,0',
                ]);
                assert.ok(
                    isRecord(decoded.raw) &&
                        typeof decoded.raw.width === 'number' &&
                        typeof decoded.raw.height === 'number',
                );
                return {
                    filePath,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                    bytes: bytes.length,
                    decoded,
                };
            },
        };
    },
    async cleanup() {
        if (!client) return { gatewayNotAcquired: true };
        const failures: string[] = [];
        let final: unknown;
        try {
            let connections = owned;
            if (!entryId) {
                const discovered = readStatus((await lifecycleTool('dct_connection_status')).structuredContent);
                entryId = discovered.entryId;
            }
            try {
                const status = readStatus(
                    (await lifecycleTool('dct_connection_status', { entryId })).structuredContent,
                );
                assert.ok('connections' in status);
                connections = status.connections;
            } catch (error) {
                failures.push(`Discovery: ${errorMessage(error)}`);
            }
            const receipts = await closeEvery(
                connections.map((connection) => async () => {
                    assert.ok(connection.sessionId);
                    try {
                        const receipt = await closeSmokeConnection(control, {
                            action: 'stop',
                            entryId,
                            connectionId: connection.connectionId,
                            sessionId: connection.sessionId,
                            requestId: randomUUID(),
                            disposition: 'Close',
                        });
                        await record('normal-close-receipt', { connection, receipt });
                        return receipt;
                    } catch (error) {
                        await record('normal-close-error', { connection, error: errorMessage(error) });
                        throw error;
                    }
                }),
            );
            await record('all-close-results', {
                connections,
                receipts: receipts.map((receipt) =>
                    receipt.status === 'fulfilled'
                        ? receipt
                        : { status: receipt.status, reason: errorMessage(receipt.reason) },
                ),
            });
            if (!receipts.every((receipt) => receipt.status === 'fulfilled'))
                failures.push('One or more normal Close operations failed.');
            final = readStatus((await lifecycleTool('dct_connection_status', { entryId })).structuredContent);
            await record('final-status', final);
            if (!isRecord(final) || !Array.isArray(final.connections) || final.connections.length !== 0)
                failures.push('Gateway retains connections.');
        } catch (error) {
            failures.push(errorMessage(error));
        } finally {
            try {
                await record('before-gateway-shutdown', { failures, owned, final });
            } finally {
                await client.close();
            }
            await record('gateway-exit', { code: client.child.exitCode, signal: client.child.signalCode });
            if (client.child.exitCode !== 0) failures.push('Gateway stdio exit was not zero.');
        }
        if (failures.length > 0) throw new Error(JSON.stringify({ failures, retainedIdentities: owned, final }));
        return { final, gatewayExitCode: client.child.exitCode };
    },
});
await save();
console.log(
    JSON.stringify({
        kind: 'probe-complete',
        folder,
        outcome: result.outcome,
        cleanup: result.cleanup,
        ...timestamp(),
    }),
);
process.exitCode = result.outcome === 'success' && result.cleanup.ok ? 0 : 1;
