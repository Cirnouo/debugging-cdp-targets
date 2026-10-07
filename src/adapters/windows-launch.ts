import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProcessTarget } from '../domains/cdp-target.ts';
import type { LaunchContext } from '../domains/control-contract.ts';
import type { LaunchDefinition } from '../domains/launch-command.ts';
import { DetailedError, isRecord } from '../shared/errors.ts';

class NativeApplication extends EventEmitter {
    pid: number;
    startedAtUtc: string;
    elevated: boolean;
    exitCode: number | null = null;
    signalCode: string | null = null;
    monitoringFailure?: string;
    monitorDisposed = false;
    private releaseMonitor: () => void;
    constructor(pid: number, startedAtUtc: string, elevated: boolean, releaseMonitor: () => void) {
        super();
        this.pid = pid;
        this.startedAtUtc = startedAtUtc;
        this.elevated = elevated;
        this.releaseMonitor = releaseMonitor;
    }
    disposeMonitor() {
        if (this.monitorDisposed) return;
        this.monitorDisposed = true;
        this.releaseMonitor();
    }
    onMonitorError(listener: () => void) {
        this.once('monitor-error', listener);
        if (this.monitoringFailure) listener();
        return () => {
            this.off('monitor-error', listener);
        };
    }
    recordExit(code: number) {
        if (this.exitCode !== null) return;
        this.exitCode = code;
        this.emit('exit');
        this.disposeMonitor();
    }
}
export interface NativeLaunchContext extends LaunchContext {
    onCreated?: (application: NativeApplication) => void;
}
type HelperProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'pid'> & {
    once(event: 'error', listener: (error: Error) => void): unknown;
    once(event: 'close', listener: () => void): unknown;
};
type HelperSpawn = (executable: string, args: string[]) => HelperProcess;
const phases = new Set([
    'inspecting-permission',
    'launching',
    'awaiting-permission',
    'permission-handshake',
    'native-operation',
    'normal-close',
    'wait-exit',
]);
function nativeFailure(value: Record<string, unknown>) {
    const error = new DetailedError('Windows native application operation failed.');
    error.details = {
        phase: typeof value.phase === 'string' && phases.has(value.phase) ? value.phase : 'native-helper',
        ...(typeof value.nativeError === 'number' ? { nativeError: value.nativeError } : {}),
        ...(typeof value.category === 'string' && /^[a-z-]+$/.test(value.category) ? { category: value.category } : {}),
        ...(typeof value.exceptionType === 'string' && /^[A-Za-z]+$/.test(value.exceptionType)
            ? { exceptionType: value.exceptionType }
            : {}),
        ...(typeof value.waitResult === 'number' ? { waitResult: value.waitResult } : {}),
        ...(typeof value.waitError === 'number' ? { waitError: value.waitError } : {}),
        closeRequested: value.closeRequested === true,
        processExited: false,
    };
    return error;
}
export function createWindowsLauncher({
    spawn: launchHelper = (executable, args) =>
        spawn(executable, args, {
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        }),
}: {
    spawn?: HelperSpawn;
} = {}) {
    const applications = new Map<string, NativeApplication>();
    const closeWaits = new WeakMap<ProcessTarget, Promise<Record<string, unknown>>>();
    const key = (target: ProcessTarget) =>
        `${target.processId}:${target.startedAtUtc}:${path.win32.resolve(target.executablePath).toLowerCase()}`;
    function helper(
        request: Record<string, unknown>,
        context: LaunchContext,
        event: (value: Record<string, unknown>) => void,
        failure: (error: Error, terminal?: boolean) => void,
        ended: () => void,
    ) {
        const windows = process.env.SystemRoot ?? 'C:/Windows';
        const executable = path.join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe');
        const script = fileURLToPath(new URL('./windows-native-helper.ps1', import.meta.url));
        const child = launchHelper(executable, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
        ]);
        let buffer = '';
        const cancel = () => {
            if (!child.stdin.destroyed) child.stdin.write('{"cancel":true}\n');
        };
        context.signal?.addEventListener('abort', cancel, { once: true });
        const detach = () => context.signal?.removeEventListener('abort', cancel);
        child.stderr.resume();
        child.stdin.on('error', () => {});
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            buffer += chunk;
            if (buffer.length > 65_536) {
                buffer = '';
                failure(new Error('Native helper exceeded its evidence limit.'));
                child.stdin.end();
                return;
            }
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                try {
                    const value: unknown = JSON.parse(line);
                    if (!isRecord(value)) throw new Error('Invalid native process evidence.');
                    if (value.event === 'phase') {
                        if (typeof value.phase !== 'string' || !phases.has(value.phase))
                            throw new Error('Invalid native process phase.');
                        context.onPhase?.(value.phase);
                    } else if (value.event === 'error') failure(nativeFailure(value));
                    else event(value);
                } catch {
                    failure(new Error('Invalid native process evidence.'));
                }
                newline = buffer.indexOf('\n');
            }
        });
        child.once('error', (error) => {
            detach();
            failure(
                nativeFailure({
                    category: 'helper-start-failed',
                    nativeError: 'errno' in error ? error.errno : undefined,
                }),
                true,
            );
        });
        child.once('close', () => {
            detach();
            ended();
        });
        child.stdout.once('end', () => failure(new Error('Native helper evidence stream ended.')));
        child.stdin.write(`${JSON.stringify(request)}\n`);
        if (context.signal?.aborted) cancel();
        return {
            child,
            detach,
            dispose: () => {
                detach();
                child.stdin.end();
            },
        };
    }
    function requestNormalClose(target: ProcessTarget, context: LaunchContext = {}): Promise<Record<string, unknown>> {
        context.signal?.throwIfAborted();
        let resolveWait: (value: Record<string, unknown>) => void = () => {};
        let rejectWait: (error: Error) => void = () => {};
        const wait = new Promise<Record<string, unknown>>((resolve, reject) => {
            resolveWait = resolve;
            rejectWait = reject;
        });
        void wait.catch(() => {});
        closeWaits.set(target, wait);
        return new Promise((resolve, reject) => {
            let requested = false;
            let complete = false;
            const failed = (error: Error) => {
                if (complete) return;
                complete = true;
                transport.dispose();
                if (!requested) reject(error);
                rejectWait(error);
            };
            const transport = helper(
                {
                    action: 'close',
                    target: {
                        processId: target.processId,
                        executablePath: target.executablePath,
                        startedAtUtc: target.startedAtUtc,
                        targetKind: target.targetKind,
                        port: target.port,
                    },
                },
                context,
                (value) => {
                    if (value.event === 'cancelled') {
                        failed(
                            context.signal?.reason instanceof Error
                                ? context.signal.reason
                                : new DOMException('Windows close authorization cancelled.', 'AbortError'),
                        );
                        return;
                    }
                    if (
                        value.processId !== target.processId ||
                        value.startedAtUtc !== target.startedAtUtc ||
                        typeof value.closeRequested !== 'boolean' ||
                        typeof value.processExited !== 'boolean'
                    )
                        throw new Error('Invalid native close identity evidence.');
                    if (value.event === 'close-requested' && !requested) {
                        requested = true;
                        resolve(value);
                        return;
                    }
                    if (
                        value.event !== 'closed' ||
                        value.closed !== true ||
                        value.processExited !== true ||
                        value.waitResult !== 0 ||
                        value.waitError !== 0 ||
                        typeof value.exitCode !== 'number'
                    )
                        throw new Error('Native handle did not confirm actual application exit.');
                    complete = true;
                    applications.get(key(target))?.recordExit(value.exitCode);
                    if (!requested) resolve(value);
                    resolveWait(value);
                    transport.dispose();
                },
                failed,
                () => failed(new Error('Native close observer exited without actual application exit evidence.')),
            );
        });
    }
    function waitForExit(target: ProcessTarget, signal?: AbortSignal): Promise<Record<string, unknown>> {
        const pending = closeWaits.get(target);
        if (!pending) return Promise.reject(new Error('No native close handle observer is available.'));
        if (!signal) return pending;
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const cancel = () => {
                signal.removeEventListener('abort', cancel);
                reject(signal.reason);
            };
            signal.addEventListener('abort', cancel, { once: true });
            pending.then(
                (value) => {
                    signal.removeEventListener('abort', cancel);
                    resolve(value);
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', cancel);
                    reject(error);
                },
            );
        });
    }
    return {
        launch(launch: LaunchDefinition, context: NativeLaunchContext = {}): Promise<NativeApplication> {
            context.signal?.throwIfAborted();
            return new Promise((resolve, reject) => {
                let application: NativeApplication | undefined;
                let launchFailure: Error | undefined;
                let cancellationReason: unknown;
                let settledWithoutApplication = false;
                const failed = (error: Error, terminal = false) => {
                    launchFailure ??= error;
                    if (application?.monitorDisposed) return;
                    if (!application && terminal) {
                        settledWithoutApplication = true;
                        reject(cancellationReason ?? launchFailure);
                    } else if (application && application.exitCode === null && !application.monitoringFailure) {
                        application.monitoringFailure = 'native-helper-exited';
                        application.emit('monitor-error');
                    }
                    // EOF cancels creation or relinquishes observation. Keep parsing until
                    // helper exit so a raced creation still supplies its real cleanup identity.
                    transport.dispose();
                };
                const transport = helper(
                    { action: 'launch', launch },
                    context,
                    (value) => {
                        if (settledWithoutApplication) return;
                        if (value.event === 'cancelled' && !application) {
                            cancellationReason ??=
                                context.signal?.reason ?? new DOMException('Windows launch cancelled.', 'AbortError');
                            transport.child.stdin.end();
                        } else if (value.event === 'started' && !application) {
                            if (
                                typeof value.processId !== 'number' ||
                                !Number.isInteger(value.processId) ||
                                value.processId <= 0 ||
                                value.processId === transport.child.pid ||
                                typeof value.startedAtUtc !== 'string' ||
                                !Number.isFinite(Date.parse(value.startedAtUtc)) ||
                                typeof value.executablePath !== 'string' ||
                                path.win32.resolve(value.executablePath).toLowerCase() !==
                                    path.win32.resolve(launch.executablePath).toLowerCase() ||
                                typeof value.elevated !== 'boolean'
                            )
                                throw new Error('Invalid actual application identity from native launch.');
                            application = new NativeApplication(
                                value.processId,
                                value.startedAtUtc,
                                value.elevated,
                                transport.dispose,
                            );
                            if (launchFailure) application.monitoringFailure = 'native-helper-exited';
                            applications.set(
                                key({
                                    processId: application.pid,
                                    startedAtUtc: application.startedAtUtc,
                                    executablePath: launch.executablePath,
                                    targetKind: 'generic-cdp',
                                    port: 0,
                                }),
                                application,
                            );
                            const actual = application;
                            const identityKey = key({
                                processId: actual.pid,
                                startedAtUtc: actual.startedAtUtc,
                                executablePath: launch.executablePath,
                                targetKind: 'generic-cdp',
                                port: 0,
                            });
                            actual.once('exit', () => {
                                if (applications.get(identityKey) === actual) applications.delete(identityKey);
                            });
                            context.onCreated?.(application);
                            transport.detach();
                            resolve(application);
                        } else if (
                            value.event === 'exited' &&
                            application &&
                            value.processId === application.pid &&
                            typeof value.exitCode === 'number'
                        ) {
                            application.recordExit(value.exitCode);
                        } else throw new Error('Unexpected native process evidence.');
                    },
                    failed,
                    () => failed(new Error('The native launch helper exited before completion.'), true),
                );
            });
        },
        requestNormalClose,
        waitForExit,
        async close(target: ProcessTarget): Promise<Record<string, unknown>> {
            await requestNormalClose(target);
            return waitForExit(target);
        },
    };
}
