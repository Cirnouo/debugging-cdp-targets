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
import { Client, ProtocolError, ProtocolErrorCode, ReadBuffer, serializeMessage } from '@modelcontextprotocol/client';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/core';
import { buildServerArguments, resolveServerBin } from './official-server.ts';

export type OfficialConnection = {
    tools: Tool[];
    call(
        name: string,
        arguments_: Record<string, unknown>,
        signal?: AbortSignal,
        onProgress?: (progress: Progress) => void,
    ): Promise<CallToolResult>;
    close(): Promise<void>;
    onExit(listener: () => void): void;
    rootsChanged(): Promise<void>;
};

export async function createOfficialConnection(
    browserUrl: string,
    options: {
        bin?: string;
        args?: string[];
        roots?: () => Promise<ListRootsResult>;
        elicitation?: {
            form: boolean;
            request: (params: ElicitRequestFormParams, signal: AbortSignal) => Promise<ElicitResult>;
        };
    } = {},
): Promise<OfficialConnection> {
    const arguments_ = options.args ?? buildServerArguments(browserUrl);
    const bin = options.bin ?? (await resolveServerBin());
    const child = spawn(process.execPath, [bin, ...arguments_], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' },
    });
    const listeners = new Set<() => void>();
    let exited = false;
    const buffer = new ReadBuffer();
    let resolveExit: () => void = () => {};
    const exit = new Promise<void>((resolve) => {
        resolveExit = resolve;
    });
    const transport: Transport = {
        async start() {
            if (child.pid !== undefined) return;
            await new Promise<void>((resolve, reject) => {
                child.once('spawn', resolve);
                child.once('error', reject);
            });
        },
        send(message: JSONRPCMessage) {
            return new Promise<void>((resolve, reject) => {
                child.stdin.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()));
            });
        },
        async close() {
            if (exited) return;
            child.stdin.end();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    exit,
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(
                                    new Error('Official MCP did not exit after normal stdin close within 10 seconds.'),
                                ),
                            10_000,
                        );
                    }),
                ]);
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
    };
    child.stderr.resume();
    child.stdin.on('error', (error) => transport.onerror?.(error));
    child.on('error', (error) => transport.onerror?.(error));
    child.stdout.on('data', (chunk: Buffer) => {
        try {
            buffer.append(chunk);
            let message = buffer.readMessage();
            while (message !== null) {
                transport.onmessage?.(message);
                message = buffer.readMessage();
            }
        } catch (error) {
            transport.onerror?.(error instanceof Error ? error : new Error('Invalid official MCP message.'));
        }
    });
    child.once('close', () => {
        exited = true;
        resolveExit();
        transport.onclose?.();
        for (const listener of listeners) listener();
        listeners.clear();
    });
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
        await client.connect(transport);
        const tools: Tool[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
            // Keep the gateway's uncapped walk; SDK listTools() aggregates at most 64 pages.
            const page = await client.request(
                { method: 'tools/list', params: cursor ? { cursor } : {} },
                ListToolsResultSchema,
            );
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
                            ...(toolDefinition ? { toolDefinition } : {}),
                            ...(signal ? { signal } : {}),
                            ...(onProgress ? { onprogress: onProgress } : {}),
                        },
                    ),
                );
            },
            close: () => client.close(),
            onExit(listener) {
                if (exited) listener();
                else listeners.add(listener);
            },
            rootsChanged: () => client.sendRootsListChanged(),
        };
    } catch (error) {
        await transport.close();
        throw error;
    }
}
