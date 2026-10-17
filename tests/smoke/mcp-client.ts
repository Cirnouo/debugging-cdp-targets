import type { SpawnOptions } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CallToolRequestParamsSchema, ElicitResultSchema, ListRootsResultSchema } from '@modelcontextprotocol/core';
import { isRecord } from '../../src/shared/errors.ts';
import { guiAuthorization } from '../gui-authorization.ts';

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
    options: Pick<SpawnOptions, 'cwd' | 'env'> & { nodeExecutable?: string } = {},
    onServerRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>,
) {
    return createHttpFixtureClient([entry], options, onServerRequest);
}

/** A test-owned child exposes real SDK HTTP; stdin EOF is explicit fixture teardown, never production IPC. */
export function createHttpFixtureClient(
    args: string[],
    options: Pick<SpawnOptions, 'cwd' | 'env'> & { nodeExecutable?: string } = {},
    onServerRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>,
) {
    const { nodeExecutable = process.execPath, ...spawnOptions } = options;
    const child = spawn(nodeExecutable, [...args, ...(guiAuthorization().allowed ? ['--allow-gui'] : [])], {
        ...spawnOptions,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
    });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
    });
    const lines = createInterface({ input: child.stdout });
    const ready = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('HTTP fixture startup deadline exceeded.')), 30_000);
        child.once('error', reject);
        child.once('exit', () => {
            clearTimeout(timer);
            reject(new Error(`HTTP fixture exited: ${stderr}`));
        });
        lines.on('line', (line) => {
            try {
                const value: unknown = JSON.parse(line);
                if (!isRecord(value) || value.fixture !== 'http-gateway' || typeof value.url !== 'string')
                    throw new Error('Unexpected HTTP fixture readiness output.');
                const endpoint = new URL(value.url);
                if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp')
                    throw new Error('Invalid HTTP fixture endpoint.');
                clearTimeout(timer);
                resolve(value.url);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    });
    void ready.catch(() => {});
    let sdk: Client | undefined;
    let initialized: Promise<Client> | undefined;
    let registration: Promise<string> | undefined;
    const connect = () =>
        (initialized ??= (async () => {
            const client = new Client(
                { name: 'native-http-fixture', version: '0.1.0' },
                {
                    capabilities: onServerRequest ? { roots: {}, elicitation: { form: {} } } : {},
                },
            );
            sdk = client;
            if (onServerRequest) {
                client.setRequestHandler('roots/list', async () =>
                    ListRootsResultSchema.parse(await onServerRequest('roots/list', {})),
                );
                client.setRequestHandler('elicitation/create', async (request) =>
                    ElicitResultSchema.parse(await onServerRequest('elicitation/create', request.params)),
                );
            }
            await client.connect(new StreamableHTTPClientTransport(new URL(await ready)));
            return client;
        })());
    const bearer = () =>
        (registration ??= (async () => {
            const result = await (await connect()).callTool({ name: 'dct_registration_register', arguments: {} });
            if (!isRecord(result.structuredContent) || typeof result.structuredContent.registrationBearer !== 'string')
                throw new Error('HTTP fixture registration did not return a bearer.');
            return result.structuredContent.registrationBearer;
        })());
    return {
        child,
        async request(
            method: string,
            params: Record<string, unknown> = {},
            timeoutMs = 60_000,
            interval?: McpRequestInterval,
        ): Promise<unknown> {
            const client = await connect();
            if (method === 'initialize')
                return {
                    serverInfo: client.getServerVersion(),
                    capabilities: client.getServerCapabilities(),
                    instructions: client.getInstructions(),
                };
            if (method === 'tools/list') return client.listTools();
            if (method !== 'tools/call') throw new Error('Unsupported native HTTP fixture method.');
            const parsed = CallToolRequestParamsSchema.parse(params);
            const arguments_ = { ...parsed.arguments };
            if (parsed.name !== 'dct_registration_register') {
                const token = await bearer();
                if (parsed.name.startsWith('dct_')) arguments_.registrationBearer ??= token;
                else if (isRecord(arguments_._dct)) arguments_._dct = { registrationBearer: token, ...arguments_._dct };
            }
            observeInterval(interval?.dispatched);
            try {
                return await client.callTool({ ...parsed, arguments: arguments_ }, { timeout: timeoutMs });
            } finally {
                observeInterval(interval?.settled);
            }
        },
        notify(method: string) {
            if (method === 'notifications/initialized') return; // connect already completed this SDK handshake.
            if (method !== 'notifications/roots/list_changed') throw new Error('Unsupported fixture notification.');
            void connect()
                .then((client) => client.sendRootsListChanged())
                .catch(() => {});
        },
        async close() {
            try {
                await sdk?.close();
            } finally {
                if (child.exitCode === null && child.signalCode === null) child.stdin.end();
                await closed;
                lines.close();
            }
        },
    };
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
