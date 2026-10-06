import { ChildProcess, type spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '../../src/shared/errors.ts';

export interface ChromeCapture {
    ownedPorts: Set<number>;
    open(stream: 'stdout' | 'stderr'): { fd: number; path: string };
    close(fd: number): void;
    record(event: Record<string, unknown>): void;
}
export function createChromeOutputFiles(directory: string): Pick<ChromeCapture, 'open' | 'close'> {
    let outputDirectory: string | undefined;
    return {
        open(stream) {
            if (stream === 'stdout') outputDirectory = mkdtempSync(path.join(directory, 'chrome-'));
            if (!outputDirectory) throw new Error('The stdout output directory is unavailable.');
            const file = path.join(outputDirectory, `${stream}.log`);
            return { fd: openSync(file, 'wx', 0o600), path: file };
        },
        close: closeSync,
    };
}
export function createDiagnosticWriter(file: string): ChromeCapture['record'] {
    writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
    const started = performance.now();
    let bytes = 0;
    let events = 0;
    let bounded = false;
    return (event) => {
        if (bounded) return;
        try {
            const timestampUtc = new Date().toISOString();
            let line = `${JSON.stringify({ timestampUtc, elapsedMs: Math.round(performance.now() - started), ...event })}\n`;
            if (Buffer.byteLength(line) > 32_768)
                line = `${JSON.stringify({ timestampUtc, event: 'event-truncated', truncated: true })}\n`;
            if (events >= 1_000 || bytes + Buffer.byteLength(line) > 262_144 - 256) {
                bounded = true;
                line = `${JSON.stringify({ timestampUtc, event: 'output-bounded' })}\n`;
            }
            appendFileSync(file, line);
            bytes += Buffer.byteLength(line);
            events += 1;
        } catch {
            /* File observation cannot suppress original target or fetch outcomes. */
        }
    };
}
export function preloadRole(entry: string | undefined, paths: { gateway: string; smokes: string[] }) {
    if (!entry) return 'inactive';
    const absolute = path.resolve(entry);
    if (absolute === paths.gateway) return 'gateway';
    return paths.smokes.includes(absolute) ? 'parent' : 'inactive';
}

function recordSafely(record: ChromeCapture['record'], event: Record<string, unknown>) {
    try {
        record(event);
    } catch {
        /* Observation must not change the original operation. */
    }
}

export function injectGatewayPreload(original: typeof spawn, node: string, gateway: string, preload: string) {
    return new Proxy(original, {
        apply(target, receiver, parameters: unknown[]) {
            const argv = parameters[1];
            if (
                parameters[0] === node &&
                Array.isArray(argv) &&
                argv.length === 1 &&
                typeof argv[0] === 'string' &&
                path.resolve(argv[0]) === gateway
            ) {
                return Reflect.apply(target, receiver, [
                    parameters[0],
                    ['--import', preload, ...argv],
                    ...parameters.slice(2),
                ]);
            }
            return Reflect.apply(target, receiver, parameters);
        },
    });
}

function chromePort(argv: unknown): number | undefined {
    if (!Array.isArray(argv)) return undefined;
    const ports = argv.filter(
        (argument: unknown): argument is string =>
            typeof argument === 'string' && /^--remote-debugging-port=\d+$/.test(argument),
    );
    if (ports.length !== 1) return undefined;
    const port = Number(ports[0]?.split('=')[1]);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
}

export function captureChromeSpawn(original: typeof spawn, chrome: string, capture: ChromeCapture) {
    return new Proxy(original, {
        apply(target, receiver, parameters: unknown[]) {
            const port = chromePort(parameters[1]);
            const options = parameters[2];
            if (
                parameters[0] !== chrome ||
                port === undefined ||
                !isRecord(options) ||
                options.stdio !== 'ignore' ||
                options.detached !== true ||
                options.shell !== false
            ) {
                return Reflect.apply(target, receiver, parameters);
            }
            const files: { fd: number; path: string }[] = [];
            const closeFiles = () => {
                for (const file of files) {
                    try {
                        capture.close(file.fd);
                    } catch {
                        /* Original spawn outcome takes precedence. */
                    }
                }
            };
            try {
                files.push(capture.open('stdout'));
                files.push(capture.open('stderr'));
            } catch (error) {
                closeFiles();
                recordSafely(capture.record, {
                    event: 'capture-open-error',
                    port,
                    error: boundedDiagnosticError(error),
                });
                return Reflect.apply(target, receiver, parameters);
            }
            try {
                const child: unknown = Reflect.apply(target, receiver, [
                    parameters[0],
                    parameters[1],
                    { ...options, stdio: ['ignore', files[0]?.fd, files[1]?.fd] },
                    ...parameters.slice(3),
                ]);
                if (child instanceof ChildProcess) {
                    if (child.pid !== undefined) capture.ownedPorts.add(port);
                    recordSafely(capture.record, {
                        event: 'chrome-created',
                        processId: child.pid,
                        port,
                        stdout: files[0]?.path,
                        stderr: files[1]?.path,
                    });
                    child.once('exit', (code, signal) => {
                        capture.ownedPorts.delete(port);
                        recordSafely(capture.record, {
                            event: 'chrome-exit',
                            processId: child.pid,
                            port,
                            code,
                            signal,
                        });
                    });
                    child.once('error', (error) => {
                        recordSafely(capture.record, {
                            event: 'chrome-error',
                            processId: child.pid,
                            port,
                            error: boundedDiagnosticError(error),
                        });
                    });
                }
                return child;
            } catch (error) {
                recordSafely(capture.record, {
                    event: 'chrome-spawn-throw',
                    port,
                    error: boundedDiagnosticError(error),
                });
                throw error;
            } finally {
                closeFiles();
            }
        },
    });
}

export function observeOwnedFetch(original: typeof fetch, ports: Set<number>, record: ChromeCapture['record']) {
    return new Proxy(original, {
        apply(target, receiver, parameters: unknown[]) {
            const url = parameters[0];
            const port =
                typeof url === 'string' ? Number(url.match(/^http:\/\/127\.0\.0\.1:(\d+)\/json\/version$/)?.[1]) : NaN;
            const owned = ports.has(port);
            const began = performance.now();
            let pending: unknown;
            try {
                pending = Reflect.apply(target, receiver, parameters);
            } catch (error) {
                if (owned) recordSafely(record, { event: 'fetch-throw', port, error: boundedDiagnosticError(error) });
                throw error;
            }
            if (owned && pending instanceof Promise) {
                void pending
                    .then(
                        (response: unknown) =>
                            recordSafely(record, {
                                event: 'fetch-success',
                                port,
                                durationMs: Math.round(performance.now() - began),
                                status: response instanceof Response ? response.status : undefined,
                            }),
                        (error: unknown) =>
                            recordSafely(record, {
                                event: 'fetch-error',
                                port,
                                durationMs: Math.round(performance.now() - began),
                                error: boundedDiagnosticError(error),
                            }),
                    )
                    .catch(() => {});
            }
            return pending;
        },
    });
}

export function boundedDiagnosticError(error: unknown): Record<string, unknown> {
    const seen = new Set<object>();
    let remaining = 16;
    function visit(value: unknown, depth: number): Record<string, unknown> {
        if (!isRecord(value)) return { message: typeof value === 'string' ? value.slice(0, 240) : 'Non-object error.' };
        if (depth >= 4 || seen.has(value) || remaining <= 0) return { truncated: true };
        remaining -= 1;
        seen.add(value);
        const result: Record<string, unknown> = {};
        for (const key of ['name', 'message', 'code', 'errno', 'syscall', 'address', 'port']) {
            const field = value[key];
            if (typeof field === 'string') result[key] = field.slice(0, 240);
            else if (typeof field === 'number' && Number.isFinite(field)) result[key] = field;
        }
        if (value.cause !== undefined) result.cause = visit(value.cause, depth + 1);
        if (Array.isArray(value.errors)) {
            result.errors = value.errors.slice(0, 3).map((nested: unknown) => visit(nested, depth + 1));
            if (value.errors.length > 3) result.truncated = true;
        }
        return result;
    }
    try {
        return visit(error, 0);
    } catch {
        return { diagnosticError: true };
    }
}
