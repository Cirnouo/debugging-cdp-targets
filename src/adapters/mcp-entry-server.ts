import type {
    CallToolResult,
    ElicitRequestFormParams,
    ElicitResult,
    ListRootsResult,
    Progress,
    Tool,
    Transport,
} from '@modelcontextprotocol/client';
import { getSupportedElicitationModes } from '@modelcontextprotocol/client';
import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { parseConnectionRoute } from '../domains/control-contract.ts';

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
export type HookEventName = (typeof HOOK_EVENTS)[number];

export function createMcpEntryServer(options: {
    tools: Tool[];
    status: (hookEventName?: HookEventName) => Record<string, unknown>;
    invoke: (
        name: string,
        arguments_: Record<string, unknown>,
        signal: AbortSignal,
        onProgress: (progress: Progress) => void,
    ) => Promise<CallToolResult>;
    transport?: Transport;
    onRootsChanged?: () => Promise<void>;
}) {
    const routeSchema = {
        type: 'object',
        properties: { connectionId: { type: 'string', format: 'uuid' }, sessionId: { type: 'string', format: 'uuid' } },
        required: ['connectionId', 'sessionId'],
        additionalProperties: false,
    };
    const tools = options.tools.map((tool) => {
        if (Object.hasOwn(tool.inputSchema.properties ?? {}, '_dct'))
            throw new Error(`Official tool ${tool.name} already owns the reserved _dct routing field.`);
        return {
            ...tool,
            inputSchema: {
                ...tool.inputSchema,
                properties: { ...tool.inputSchema.properties, _dct: routeSchema },
                required: [...(tool.inputSchema.required ?? []), '_dct'],
            },
        };
    });
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
    server.setNotificationHandler('notifications/roots/list_changed', async () => {
        if (supportsRoots()) await options.onRootsChanged?.();
    });
    const supportsFormElicitation = () =>
        getSupportedElicitationModes(server.getClientCapabilities()?.elicitation).supportsFormMode;
    const elicit = (params: ElicitRequestFormParams, signal?: AbortSignal): Promise<ElicitResult> => {
        if (!supportsFormElicitation()) {
            throw new ProtocolError(ProtocolErrorCode.InvalidRequest, 'Host does not support form-mode elicitation.');
        }
        return server.elicitInput(params, signal ? { signal } : {});
    };
    server.setRequestHandler('tools/list', async () => ({
        tools: [
            ...tools,
            {
                name: 'dct_connection_status',
                description: '查看目标连接状态',
                inputSchema: {
                    type: 'object',
                    properties: {
                        hookEventName: {
                            type: 'string',
                            enum: [...HOOK_EVENTS],
                            description: 'Only for automatic Codex Hooks; Agents use empty arguments for status.',
                        },
                    },
                    additionalProperties: false,
                },
            },
        ],
    }));
    server.setRequestHandler('tools/call', async (request, ctx) => {
        const name = request.params.name;
        if (name === 'dct_connection_status') {
            const arguments_ = request.params.arguments ?? {};
            const hook = arguments_.hookEventName;
            if (
                Object.keys(arguments_).some((key) => key !== 'hookEventName') ||
                (hook !== undefined && !HOOK_EVENTS.some((event) => event === hook))
            )
                throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid lifecycle status Hook arguments.');
            const result = options.status(HOOK_EVENTS.find((event) => event === hook));
            return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
        }
        if (!options.tools.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`);
        parseConnectionRoute(request.params.arguments?._dct);
        const token = request.params._meta?.progressToken;
        return options.invoke(name, request.params.arguments ?? {}, ctx.mcpReq.signal, (progress) => {
            if (token !== undefined) {
                void ctx.mcpReq
                    .notify({
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
            await server.connect(options.transport ?? new StdioServerTransport());
        },
        closed,
        close: () => server.close(),
        roots: (): Promise<ListRootsResult> => server.listRoots(),
        supportsFormElicitation,
        supportsRoots,
        elicit,
    };
}
