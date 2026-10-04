import { spawn } from 'node:child_process';
import type {
    CallToolResult,
    ElicitRequestFormParams,
    ElicitResult,
    JSONRPCMessage,
    ListRootsResult,
    Progress,
    Tool,
    Transport,
} from '@modelcontextprotocol/client';
import {
    Client,
    ProtocolError,
    ProtocolErrorCode,
    ReadBuffer,
    SdkError,
    SdkErrorCode,
    serializeMessage,
} from '@modelcontextprotocol/client';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/core';
import { CLOSE_TIMEOUT_SECONDS } from '../shared/constants.ts';
import { buildServerArguments, resolveServerBin } from './official-server.ts';

export type OfficialConnectionResource = {
    close(): Promise<void>;
    onExit(listener: () => void): void;
};

export type OfficialConnection = OfficialConnectionResource & {
    tools: Tool[];
    call(
        name: string,
        arguments_: Record<string, unknown>,
        signal?: AbortSignal,
        onProgress?: (progress: Progress) => void,
    ): Promise<CallToolResult>;
    rootsChanged(): Promise<void>;
};

const STDIN_GRACE_MS = 2000;
const TERM_GRACE_MS = 2000;

export function interruptedOfficialCall(error: unknown, signal?: AbortSignal) {
    if (signal?.aborted) return 'upstream-cancelled';
    if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) return 'upstream-timeout';
    return undefined;
}

export async function createOfficialConnection(
    browserUrl: string,
    options: {
        bin?: string;
        args?: string[];
        requestTimeoutMs?: number;
        signal?: AbortSignal;
        onAcquired?: (resource: OfficialConnectionResource) => void;
        roots?: () => Promise<ListRootsResult>;
        elicitation?: {
            form: boolean;
            request: (params: ElicitRequestFormParams, signal: AbortSignal) => Promise<ElicitResult>;
        };
    } = {},
): Promise<OfficialConnection> {
    options.signal?.throwIfAborted();
    const arguments_ = options.args ?? buildServerArguments(browserUrl);
    const bin = options.bin ?? (await resolveServerBin());
    options.signal?.throwIfAborted();
    const child = spawn(process.execPath, [bin, ...arguments_], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' },
    });
    const listeners = new Set<() => void>();
    let exited = false;
    let closed = false;
    let closeNotified = false;
    let stdinEnded = false;
    let closing: Promise<void> | undefined;
    const buffer = new ReadBuffer();
    let resolveExit: () => void = () => {};
    const exit = new Promise<void>((resolve) => {
        resolveExit = resolve;
    });
    const spawned = new Promise<Error | undefined>((resolve) => {
        child.once('spawn', () => resolve(undefined));
        child.once('error', (error) => resolve(error));
    });
    function closeProtocol() {
        closed = true;
        buffer.clear();
        if (!closeNotified && transport.onclose) {
            closeNotified = true;
            transport.onclose();
        }
    }
    function releaseStreams() {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
    }
    child.once('exit', () => {
        exited = true;
        resolveExit();
        closeProtocol();
        options.signal?.removeEventListener('abort', abortAcquisition);
        releaseStreams();
        for (const listener of listeners) listener();
        listeners.clear();
    });
    async function waitForExit(milliseconds: number) {
        if (exited) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                exit.then(() => true),
                new Promise<boolean>((resolve) => {
                    timer = setTimeout(() => resolve(false), Math.max(0, milliseconds));
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    async function reapOwnedChild() {
        const deadline = performance.now() + CLOSE_TIMEOUT_SECONDS * 1000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let spawnError: Error | undefined;
        try {
            spawnError = await Promise.race([
                spawned,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('Official MCP spawn did not settle within 10 seconds.')),
                        Math.max(0, deadline - performance.now()),
                    );
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
        if (spawnError) {
            options.signal?.removeEventListener('abort', abortAcquisition);
            releaseStreams();
            return;
        }
        if (exited) return;
        if (!stdinEnded) {
            stdinEnded = true;
            if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
        }
        if (await waitForExit(Math.min(STDIN_GRACE_MS, deadline - performance.now()))) return;
        if (!child.kill('SIGTERM') && !exited)
            throw new Error('Could not signal owned official MCP child with SIGTERM.');
        if (await waitForExit(Math.min(TERM_GRACE_MS, deadline - performance.now()))) return;
        if (!child.kill('SIGKILL') && !exited)
            throw new Error('Could not signal owned official MCP child with SIGKILL.');
        if (!(await waitForExit(deadline - performance.now()))) {
            throw new Error('Official MCP child exit was not observed within 10 seconds of close.');
        }
    }
    const resource: OfficialConnectionResource = {
        close() {
            closeProtocol();
            if (exited) return Promise.resolve();
            if (!closing) {
                closing = reapOwnedChild().finally(() => {
                    closing = undefined;
                });
            }
            return closing;
        },
        onExit(listener) {
            if (exited) listener();
            else listeners.add(listener);
        },
    };
    function abortAcquisition() {
        void resource.close().catch(() => {});
    }
    const transport: Transport = {
        async start() {
            if (closed) {
                closeProtocol();
                throw new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed');
            }
            const spawnError = await spawned;
            if (spawnError) throw spawnError;
            if (closed) {
                closeProtocol();
                throw new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed');
            }
        },
        send(message: JSONRPCMessage) {
            if (closed) return Promise.reject(new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'));
            return new Promise<void>((resolve, reject) => {
                child.stdin.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()));
            });
        },
        close() {
            void resource.close().catch(() => {});
            return Promise.resolve();
        },
    };
    child.stderr.resume();
    child.stdin.on('error', (error) => {
        if (!closed) transport.onerror?.(error);
    });
    child.on('error', (error) => {
        if (!closed) transport.onerror?.(error);
    });
    child.stdout.once('end', abortAcquisition);
    child.stdout.once('close', abortAcquisition);
    child.stdout.on('data', (chunk: Buffer) => {
        if (closed) return;
        try {
            buffer.append(chunk);
            let message = buffer.readMessage();
            while (!closed && message !== null) {
                transport.onmessage?.(message);
                message = buffer.readMessage();
            }
        } catch (error) {
            transport.onerror?.(error instanceof Error ? error : new Error('Invalid official MCP message.'));
        }
    });
    options.signal?.addEventListener('abort', abortAcquisition, { once: true });
    const client = new Client(
        { name: 'debugging-cdp-targets', version: '0.1.0' },
        {
            capabilities: {
                ...(options.roots ? { roots: { listChanged: true } } : {}),
                ...(options.elicitation?.form ? { elicitation: { form: {} } } : {}),
            },
        },
    );
    if (options.roots) client.setRequestHandler('roots/list', options.roots);
    if (options.elicitation?.form) {
        const forward = options.elicitation.request;
        client.setRequestHandler('elicitation/create', (request, ctx) => {
            if (request.params.mode === 'url') {
                throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'URL-mode elicitation is not supported.');
            }
            return forward(request.params, ctx.mcpReq.signal);
        });
    }
    try {
        options.onAcquired?.(resource);
        if (options.signal?.aborted) abortAcquisition();
        options.signal?.throwIfAborted();
        await client.connect(transport);
        options.signal?.throwIfAborted();
        const tools: Tool[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
            options.signal?.throwIfAborted();
            // Keep the gateway's uncapped walk; SDK listTools() aggregates at most 64 pages.
            const page = await client.request(
                { method: 'tools/list', params: cursor ? { cursor } : {} },
                ListToolsResultSchema,
            );
            options.signal?.throwIfAborted();
            tools.push(...page.tools);
            cursor = page.nextCursor;
            if (cursor !== undefined) {
                if (cursors.has(cursor)) throw new Error('Official MCP returned a repeated tool catalog cursor.');
                cursors.add(cursor);
            }
        } while (cursor !== undefined);
        return {
            tools,
            call: async (name, arguments_, signal, onProgress) => {
                const toolDefinition = tools.findLast((tool) => tool.name === name);
                return CallToolResultSchema.parse(
                    await client.callTool(
                        { name, arguments: arguments_ },
                        {
                            timeout: options.requestTimeoutMs ?? 60_000,
                            ...(toolDefinition ? { toolDefinition } : {}),
                            ...(signal ? { signal } : {}),
                            ...(onProgress ? { onprogress: onProgress } : {}),
                        },
                    ),
                );
            },
            close: resource.close,
            onExit: resource.onExit,
            rootsChanged: () => client.sendRootsListChanged(),
        };
    } catch (error) {
        const cleanup = resource.close();
        if (options.onAcquired) void cleanup.catch(() => {});
        else await cleanup;
        throw error;
    }
}
