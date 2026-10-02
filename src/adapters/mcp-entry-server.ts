import { getSupportedElicitationModes } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
    CallToolResult,
    ElicitRequestFormParams,
    ElicitResult,
    ListRootsResult,
    Progress,
    Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { preserveZeroRequestCancellation } from './mcp-transport.ts';

type LossChoice = 'restart' | 'cancel' | 'pending';
type AskLoss = (message: string, signal?: AbortSignal) => Promise<LossChoice>;

export function createMcpEntryServer(options: {
    tools: Tool[];
    status: () => Record<string, unknown>;
    watch: (signal: AbortSignal, ask: AskLoss) => Promise<Record<string, unknown>>;
    invoke: (
        name: string,
        arguments_: Record<string, unknown>,
        signal: AbortSignal,
        onProgress: (progress: Progress) => void,
    ) => Promise<CallToolResult>;
    transport?: Transport;
    onRootsChanged?: () => Promise<void>;
}) {
    const server = new Server({ name: 'debugging-cdp-targets', version: '0.1.0' }, { capabilities: { tools: {} } });
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    const onStdinEnd = () => {
        void server.close().catch(() => resolveClosed());
    };
    server.onclose = () => {
        process.stdin.off('end', onStdinEnd);
        resolveClosed();
    };
    const supportsRoots = () => server.getClientCapabilities()?.roots !== undefined;
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
        if (supportsRoots()) await options.onRootsChanged?.();
    });
    const supportsFormElicitation = () =>
        getSupportedElicitationModes(server.getClientCapabilities()?.elicitation).supportsFormMode;
    const elicit = (params: ElicitRequestFormParams, signal?: AbortSignal): Promise<ElicitResult> => {
        if (!supportsFormElicitation()) {
            throw new McpError(ErrorCode.InvalidRequest, 'Host does not support form-mode elicitation.');
        }
        return server.elicitInput(params, signal ? { signal } : {});
    };
    const askLoss: AskLoss = async (message, signal) => {
        if (!supportsFormElicitation()) return 'pending';
        try {
            const result = await elicit(
                {
                    mode: 'form',
                    message,
                    requestedSchema: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                title: '目标连接已断开，请选择下一步',
                                enum: ['restart', 'cancel'],
                                enumNames: ['误关闭，使用原端口重新启动', '有意关闭，终止依赖该目标的任务'],
                            },
                        },
                        required: ['action'],
                    },
                },
                signal,
            );
            if (result.action !== 'accept') return 'pending';
            const action = result.content?.action;
            return action === 'restart' || action === 'cancel' ? action : 'pending';
        } catch {
            return 'pending';
        }
    };
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            ...options.tools,
            {
                name: 'dct_connection_status',
                description: '查看目标连接状态',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            },
            {
                name: 'dct_watch_target',
                description: '等待目标退出并询问是否重新启动',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            },
        ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const name = request.params.name;
        if (name === 'dct_connection_status' || name === 'dct_watch_target') {
            if (Object.keys(request.params.arguments ?? {}).length !== 0) {
                throw new McpError(ErrorCode.InvalidParams, `${name} requires an empty argument object.`);
            }
            const result =
                name === 'dct_connection_status' ? options.status() : await options.watch(extra.signal, askLoss);
            return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
        }
        if (!options.tools.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`);
        const token = request.params._meta?.progressToken;
        return options.invoke(name, request.params.arguments ?? {}, extra.signal, (progress) => {
            if (token !== undefined) {
                void extra
                    .sendNotification({
                        method: 'notifications/progress',
                        params: { ...progress, progressToken: token },
                    })
                    .catch(() => {});
            }
        });
    });
    return {
        async connect() {
            if (!options.transport) process.stdin.once('end', onStdinEnd);
            await server.connect(preserveZeroRequestCancellation(options.transport ?? new StdioServerTransport()));
        },
        closed,
        close: () => server.close(),
        roots: (): Promise<ListRootsResult> => server.listRoots(),
        askLoss,
        supportsFormElicitation,
        supportsRoots,
        elicit,
    };
}
