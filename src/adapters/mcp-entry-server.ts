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
import { type ControlRequest, parseConnectionRoute, parseControlRequest } from '../domains/control-contract.ts';
import { LIFECYCLE_ACTIONS, lifecycleTools } from './lifecycle-tools.ts';

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
export type HookEventName = (typeof HOOK_EVENTS)[number];

export function createMcpEntryServer(options: {
    tools: Tool[];
    status: (hookEventName?: HookEventName) => Record<string, unknown>;
    control?: (request: ControlRequest, signal?: AbortSignal) => Promise<Record<string, unknown>>;
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
        if (Object.hasOwn(LIFECYCLE_ACTIONS, tool.name))
            throw new Error('Official tool collides with a lifecycle tool.');
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
        tools: [...tools, ...lifecycleTools(HOOK_EVENTS)],
    }));
    server.setRequestHandler('tools/call', async (request, ctx) => {
        const name = request.params.name;
        if (Object.hasOwn(LIFECYCLE_ACTIONS, name)) {
            const arguments_ = request.params.arguments ?? {};
            const hook = arguments_.hookEventName;
            try {
                let result: Record<string, unknown>;
                if (hook !== undefined) {
                    if (
                        name !== 'dct_connection_status' ||
                        Object.keys(arguments_).length !== 1 ||
                        !HOOK_EVENTS.some((event) => event === hook)
                    )
                        throw new Error('Invalid lifecycle status Hook arguments.');
                    result = options.status(HOOK_EVENTS.find((event) => event === hook));
                } else {
                    if (Object.hasOwn(arguments_, 'action'))
                        throw new Error('The tool name selects its lifecycle action.');
                    const control = parseControlRequest({ ...arguments_, action: LIFECYCLE_ACTIONS[name] });
                    if (options.control) result = await options.control(control, ctx.mcpReq.signal);
                    else if (control.action === 'status' && Object.keys(arguments_).length === 0)
                        result = options.status();
                    else throw new Error('Lifecycle control is unavailable.');
                }
                return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
            } catch (error) {
                throw new ProtocolError(
                    ProtocolErrorCode.InvalidParams,
                    error instanceof Error ? error.message : 'Invalid lifecycle request.',
                );
            }
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
