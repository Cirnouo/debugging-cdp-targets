import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import {
    createPlatformAdapter,
    type PlatformAdapter,
    validateProcessIdentity,
} from '../../src/adapters/platform-process.ts';
import { type ProcessTarget, validateCdpIdentity } from '../../src/domains/cdp-target.ts';
import { isRecord } from '../../src/shared/errors.ts';

interface ProfileProbeOptions {
    platform?: Pick<PlatformAdapter, 'snapshot'>;
    timeoutMs?: number;
    cleanupTimeoutMs?: number;
    pollMs?: number;
}

function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
}

function pageId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function pageSocket(value: unknown, target: ProcessTarget, id: string): string {
    assert.ok(typeof value === 'string', 'The profile page socket endpoint is missing.');
    const expected = `ws://127.0.0.1:${target.port}/devtools/page/${id}`;
    assert.equal(value, expected, 'The profile page socket must identify only the new page on the owned listener.');
    return expected;
}

async function connect(socket: WebSocket, signal: AbortSignal): Promise<void> {
    await bounded(
        new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                socket.off('open', opened);
                socket.off('error', failed);
                socket.off('close', closed);
            };
            const opened = () => {
                cleanup();
                resolve();
            };
            const failed = (error: Error) => {
                cleanup();
                reject(error);
            };
            const closed = () => {
                cleanup();
                reject(new Error('The profile page socket closed before connecting.'));
            };
            socket.once('open', opened);
            socket.once('error', failed);
            socket.once('close', closed);
        }),
        signal,
    );
}

async function evaluate(socket: WebSocket, id: number, signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const cleanup = () => {
            socket.off('message', message);
            socket.off('error', failed);
            socket.off('close', closed);
            signal.removeEventListener('abort', aborted);
        };
        const failed = (error: unknown) => {
            cleanup();
            reject(error);
        };
        const closed = () => failed(new Error('The profile page socket closed before returning evidence.'));
        const aborted = () => failed(signal.reason);
        const message = (bytes: WebSocket.RawData) => {
            try {
                const reply: unknown = JSON.parse(bytes.toString());
                assert.ok(isRecord(reply), 'The profile CDP response must be an object.');
                if (reply.id === undefined) return;
                assert.equal(reply.id, id, 'The profile CDP response has an unexpected request ID.');
                assert.ok(!reply.error && isRecord(reply.result), 'The profile CDP evaluation failed.');
                assert.ok(
                    !reply.result.exceptionDetails && isRecord(reply.result.result),
                    'The profile script failed.',
                );
                const value = reply.result.result.value;
                assert.ok(isRecord(value), 'The profile script must return document and profile evidence.');
                cleanup();
                resolve(value);
            } catch (error) {
                failed(error);
            }
        };
        socket.on('message', message);
        socket.once('error', failed);
        socket.once('close', closed);
        signal.addEventListener('abort', aborted, { once: true });
        socket.send(
            JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: {
                    expression:
                        "({url: location.href, profilePath: document.getElementById('profile_path')?.textContent?.trim() ?? ''})",
                    returnByValue: true,
                    awaitPromise: true,
                },
            }),
            (error) => {
                if (error) failed(error);
            },
        );
    });
}

async function closeSocket(socket: WebSocket, timeoutMs: number): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => socket.terminate(), timeoutMs);
        socket.once('close', () => {
            clearTimeout(timer);
            resolve();
        });
        socket.close();
    });
}

/** Test-only observation of a newly launched, independently verified Chrome fixture. */
export async function readChromeSmokeProfile(
    target: ProcessTarget,
    options: ProfileProbeOptions = {},
): Promise<string> {
    assert.equal(target.targetKind, 'chrome');
    assert.ok(Number.isInteger(target.port) && target.port > 0 && target.port <= 65535);
    const platform = options.platform ?? createPlatformAdapter();
    // Native identity snapshots on Windows take about 3.5 seconds each. These
    // whole-probe budgets include every snapshot, not only HTTP/CDP readiness.
    const timeoutMs = options.timeoutMs ?? 45_000;
    const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 20_000;
    const signal = AbortSignal.timeout(timeoutMs);
    const origin = `http://127.0.0.1:${target.port}`;
    let browserSocket: string | undefined;
    const request = async (route: string, method: 'GET' | 'PUT', active: AbortSignal) => {
        const response = await fetch(`${origin}${route}`, { method, redirect: 'error', signal: active });
        assert.ok(response.ok, `The profile probe HTTP ${method} ${route} failed with ${response.status}.`);
        return response;
    };
    const guard = async (active: AbortSignal) => {
        const before = await bounded(platform.snapshot(target.processId, target.port), active);
        validateProcessIdentity(before, target);
        const endpoint: unknown = await (await request('/json/version', 'GET', active)).json();
        const after = await bounded(platform.snapshot(target.processId, target.port), active);
        validateProcessIdentity(after, target);
        for (const evidence of [before, after]) {
            const identity = validateCdpIdentity({
                endpoint,
                port: target.port,
                listeners: evidence.listeners,
                processIds: evidence.processIds,
                targetKind: target.targetKind,
            });
            if (browserSocket === undefined) browserSocket = identity.webSocketDebuggerUrl;
            assert.equal(identity.webSocketDebuggerUrl, browserSocket, 'The owned Chrome browser endpoint changed.');
        }
    };
    let id: string | undefined;
    let socket: WebSocket | undefined;
    let profilePath: string | undefined;
    let failure: unknown;
    try {
        await guard(signal);
        const previous: unknown = await (await request('/json/list', 'GET', signal)).json();
        assert.ok(
            Array.isArray(previous) && previous.every((page: unknown) => isRecord(page) && pageId(page.id)),
            'The owned page inventory must contain valid target IDs.',
        );
        const existing = new Set(previous.map((page: Record<string, unknown>) => page.id));
        await guard(signal);
        const created: unknown = await (
            await request(`/json/new?${encodeURIComponent('chrome://version/')}`, 'PUT', signal)
        ).json();
        assert.ok(isRecord(created) && pageId(created.id), 'The new profile target must contain a valid page ID.');
        assert.ok(!existing.has(created.id), 'The profile target ID must identify a fresh page.');
        id = created.id;
        assert.equal(created.type, 'page', 'The new profile target must be a page.');
        const endpoint = pageSocket(created.webSocketDebuggerUrl, target, id);
        await guard(signal);
        socket = new WebSocket(endpoint, { handshakeTimeout: timeoutMs });
        // A socket can error during finally after the awaited request has removed its listeners.
        socket.on('error', () => {});
        await connect(socket, signal);
        for (let sequence = 1; ; sequence += 1) {
            const evidence = await evaluate(socket, sequence, signal);
            assert.ok(isRecord(evidence));
            if (
                evidence.url === 'chrome://version/' &&
                typeof evidence.profilePath === 'string' &&
                evidence.profilePath
            ) {
                profilePath = evidence.profilePath;
                break;
            }
            await delay(options.pollMs ?? 100, undefined, { signal });
        }
        await guard(signal);
    } catch (error) {
        failure = error;
    } finally {
        if (socket) await closeSocket(socket, Math.min(cleanupTimeoutMs, 1_000));
        if (id) {
            try {
                const cleanupSignal = AbortSignal.timeout(cleanupTimeoutMs);
                await guard(cleanupSignal);
                await (await request(`/json/close/${id}`, 'GET', cleanupSignal)).text();
                await guard(cleanupSignal);
            } catch (error) {
                failure =
                    failure === undefined
                        ? error
                        : new AggregateError([failure, error], 'The profile probe and its cleanup failed.');
            }
        }
    }
    if (failure !== undefined) throw failure;
    assert.ok(profilePath, 'The Chrome version document must report a nonempty profile path.');
    return profilePath;
}
