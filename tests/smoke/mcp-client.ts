import type { SpawnOptions } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isRecord } from '../../src/shared/errors.ts';

export interface McpRequestInterval {
    dispatched(): void;
    settled(): void;
}

function observeInterval(action: (() => void) | undefined) {
    // Observation cannot change resolution/rejection or strand an unrelated pending request.
    try {
        action?.();
    } catch {}
}

export function createClient(
    entry: string,
    options: Pick<SpawnOptions, 'cwd' | 'env'> = {},
    onServerRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>,
) {
    return createStdioClient(process.execPath, [entry], options, onServerRequest);
}

export function createStdioClient(
    executable: string,
    args: string[],
    options: Pick<SpawnOptions, 'cwd' | 'env'> = {},
    onServerRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    onNotification?: (method: string, params: Record<string, unknown>) => void,
) {
    const child = spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        ...options,
    });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    const pending = new Map<
        number,
        { resolve(value: unknown): void; reject(reason: Error): void; timeout: NodeJS.Timeout }
    >();
    let id = 0;
    let stderr = '';
    child.stderr.on('data', (data) => {
        stderr += data;
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            throw new Error(`Non-MCP stdout: ${line.slice(0, 100)}`);
        }
        if (!isRecord(message)) return;
        if (typeof message.method === 'string' && message.id === undefined) {
            onNotification?.(message.method, isRecord(message.params) ? message.params : {});
            return;
        }
        if (typeof message.method === 'string' && (typeof message.id === 'number' || typeof message.id === 'string')) {
            const requestId = message.id;
            const reply = (result: unknown) =>
                child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, result })}\n`);
            if (!onServerRequest) {
                child.stdin.write(
                    `${JSON.stringify({ jsonrpc: '2.0', id: requestId, error: { code: -32601, message: 'Unsupported test client server request.' } })}\n`,
                );
                return;
            }
            void onServerRequest(message.method, isRecord(message.params) ? message.params : {}).then(
                reply,
                (error: unknown) => {
                    child.stdin.write(
                        `${JSON.stringify({ jsonrpc: '2.0', id: requestId, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })}\n`,
                    );
                },
            );
            return;
        }
        if (typeof message.id !== 'number' || !pending.has(message.id)) return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
    });
    child.once('exit', () => {
        for (const { reject, timeout } of pending.values()) {
            clearTimeout(timeout);
            reject(new Error(stderr));
        }
        pending.clear();
    });
    return {
        child,
        request(
            method: string,
            params: Record<string, unknown> = {},
            timeoutMs = 60_000,
            interval?: McpRequestInterval,
        ): Promise<unknown> {
            id += 1;
            const current = id;
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    const request = pending.get(current);
                    pending.delete(current);
                    request?.reject(new Error(`MCP timeout: ${method}: ${stderr}`));
                }, timeoutMs);
                const request = {
                    resolve(value: unknown) {
                        observeInterval(interval?.settled);
                        resolve(value);
                    },
                    reject(reason: Error) {
                        observeInterval(interval?.settled);
                        reject(reason);
                    },
                    timeout,
                };
                pending.set(current, request);
                try {
                    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: current, method, params })}\n`);
                    observeInterval(interval?.dispatched);
                } catch (error) {
                    pending.delete(current);
                    clearTimeout(timeout);
                    request.reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        },
        notify(method: string) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
        },
        async close() {
            if (child.exitCode === null && child.signalCode === null) child.stdin.end();
            await closed;
            lines.close();
        },
    };
}

export function readMcpTools(value: unknown): { name: string }[] {
    if (!isRecord(value) || !Array.isArray(value.tools)) throw new Error('Invalid MCP tools/list result.');
    return value.tools.map((tool: unknown) => {
        if (!isRecord(tool) || typeof tool.name !== 'string') throw new Error('Invalid MCP tool identity.');
        return { name: tool.name };
    });
}
