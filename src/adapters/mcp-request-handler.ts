import { createHash, randomBytes } from 'node:crypto';
import type { CallToolResult, ListRootsResult, Tool } from '@modelcontextprotocol/client';
import { getSupportedElicitationModes } from '@modelcontextprotocol/client';
import { ClientCapabilitiesSchema, ListRootsResultSchema } from '@modelcontextprotocol/core';
import {
    CLIENT_CAPABILITIES_META_KEY,
    createRequestStateCodec,
    inputRequired,
    ProtocolError,
    ProtocolErrorCode,
    Server,
} from '@modelcontextprotocol/server';
import { type CoreControlRequest, parseControlRequest } from '../domains/control-contract.ts';
import { parseRegisteredArguments, parseRegisteredOfficialArguments } from '../domains/mcp-http.ts';
import { RequestFailure, requestFailureExplanation } from '../domains/request-failure.ts';
import type { ClientRequestContext, ClientRequestFacilities } from '../shared/client-context.ts';
import { isRecord } from '../shared/errors.ts';
import { LIFECYCLE_ACTIONS, lifecycleTools } from './lifecycle-tools.ts';

export type McpHttpCore = {
    tools: Tool[];
    register(): { principal: { registrationId: string }; bearer: string };
    attachClient(bearer: string): {
        request(facilities: ClientRequestFacilities): ClientRequestContext;
        detach(): void;
    };
    control(request: CoreControlRequest, context: ClientRequestContext): Promise<Record<string, unknown>>;
    invoke(name: string, arguments_: Record<string, unknown>, context: ClientRequestContext): Promise<CallToolResult>;
};

const INSTRUCTIONS =
    'Connect directly to the local desktop App. Call dct_registration_register once and retain its one-time registrationBearer. Pass that bearer explicitly to every lifecycle request and inside _dct with current connectionId/sessionId for each official tool. Registrations own resources independently of chats, HTTP and MCP sessions. Never replay a start on reconnect. Follow the debugging-cdp-targets Skill before new target launches and obtain Close/Keep before ending target work.';
declare const __DCT_APP_VERSION__: string;
type RootsState = {
    version: 1;
    phase: 'roots';
    registrationId: string;
    name: string;
    fingerprint: string;
    expires: number;
};
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (isRecord(value))
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
        );
    return value;
}

function fingerprint(value: unknown) {
    return createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
}

/** One declaration/dispatch owner shared by per-request modern and sessionful legacy SDK Servers. */
export function createMcpRequestHandler(core: McpHttpCore) {
    const lifetime = new AbortController();
    const codec = createRequestStateCodec<RootsState>({
        key: randomBytes(32),
        ttlSeconds: 600,
        bind: (context) => context.mcpReq.method,
    });
    const lifecycle = lifecycleTools();
    const reserved = new Set(lifecycle.map((tool) => tool.name));
    const routeSchema = {
        type: 'object',
        properties: {
            registrationBearer: { type: 'string', minLength: 32, maxLength: 128 },
            connectionId: { type: 'string', format: 'uuid' },
            sessionId: { type: 'string', format: 'uuid' },
        },
        required: ['registrationBearer', 'connectionId', 'sessionId'],
        additionalProperties: false,
    };
    const tools = core.tools.map((tool) => {
        if (reserved.has(tool.name) || Object.hasOwn(tool.inputSchema.properties ?? {}, '_dct'))
            throw new Error('Official catalog collides with reserved App routing.');
        return {
            ...tool,
            inputSchema: {
                ...tool.inputSchema,
                properties: { ...tool.inputSchema.properties, _dct: routeSchema },
                required: [...(tool.inputSchema.required ?? []), '_dct'],
            },
        };
    });
    function createServer(options: { era: 'legacy' | 'modern'; legacyLifetime?: () => AbortSignal }) {
        const modern = options.era === 'modern';
        const server = new Server(
            {
                name: 'debugging-cdp-targets',
                version: typeof __DCT_APP_VERSION__ === 'undefined' ? '0.1.0' : __DCT_APP_VERSION__,
            },
            { capabilities: { tools: {} }, instructions: INSTRUCTIONS, requestState: { verify: codec.verify } },
        );
        server.onerror = () => {};
        server.setRequestHandler('tools/list', async () => ({ tools: [...tools, ...lifecycle] }));
        server.setRequestHandler('tools/call', async (request, context) => {
            const name = request.params.name;
            const arguments_ = request.params.arguments ?? {};
            let authenticated = false;
            try {
                if (name === 'dct_registration_register') {
                    if (Object.keys(arguments_).length || context.mcpReq.requestState() !== undefined)
                        throw new Error('Register takes no arguments or continuation.');
                    const created = core.register();
                    const result = {
                        registrationId: created.principal.registrationId,
                        registrationBearer: created.bearer,
                    };
                    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
                }
                const action = Object.hasOwn(LIFECYCLE_ACTIONS, name) ? LIFECYCLE_ACTIONS[name] : undefined;
                const parsed = action
                    ? parseRegisteredArguments(arguments_)
                    : parseRegisteredOfficialArguments(arguments_);
                const client = core.attachClient(parsed.registrationBearer);
                authenticated = true;
                const envelope = context.mcpReq.envelope;
                const rawCapabilities = isRecord(envelope) ? envelope[CLIENT_CAPABILITIES_META_KEY] : undefined;
                const checkedCapabilities =
                    modern && rawCapabilities !== undefined
                        ? await ClientCapabilitiesSchema['~standard'].validate(rawCapabilities)
                        : undefined;
                if (checkedCapabilities?.issues) throw new Error('Invalid request capabilities.');
                const capabilities = modern ? checkedCapabilities?.value : server.getClientCapabilities();
                const supported = {
                    roots: capabilities?.roots !== undefined,
                    formElicitation: getSupportedElicitationModes(capabilities?.elicitation).supportsFormMode,
                };
                const control = action ? parseControlRequest({ ...parsed.arguments, action }) : undefined;
                if (action && Object.hasOwn(parsed.arguments, 'action'))
                    throw new Error('Tool name selects its action.');
                const principal = client.request({ requestId: context.mcpReq.id, capabilities: supported }).principal;
                const state = context.mcpReq.requestState<RootsState>();
                let roots: ListRootsResult = { roots: [] };
                if (modern && control?.action === 'start') {
                    const hash = fingerprint(parsed.arguments);
                    // MAC verification precedes dispatch. Signed fields still require current principal/request binding.
                    if (
                        state &&
                        (state.version !== 1 ||
                            state.phase !== 'roots' ||
                            state.registrationId !== principal.registrationId ||
                            state.name !== name ||
                            state.fingerprint !== hash ||
                            state.expires <= Date.now() ||
                            !supported.roots)
                    )
                        throw new Error('Invalid start continuation.');
                    if (supported.roots) {
                        const value = context.mcpReq.inputResponses?.roots;
                        if (value !== undefined && state) {
                            const checked = await ListRootsResultSchema['~standard'].validate(value);
                            if (checked.issues) throw new Error('Invalid roots response.');
                            roots = structuredClone(checked.value);
                        } else {
                            const next: RootsState =
                                state?.phase === 'roots'
                                    ? state
                                    : {
                                          version: 1,
                                          phase: 'roots',
                                          registrationId: principal.registrationId,
                                          name,
                                          fingerprint: hash,
                                          expires: Date.now() + 600_000,
                                      };
                            return inputRequired({
                                inputRequests: { roots: inputRequired.listRoots() },
                                requestState: await codec.mint(next, context),
                            });
                        }
                    }
                } else if (state) throw new Error('Unexpected continuation.');
                const token = request.params._meta?.progressToken;
                let requestActive = true;
                const startLifetime = new AbortController();
                const startAborted = () => startLifetime.abort(context.mcpReq.signal.reason);
                const modernStart = modern && control?.action === 'start';
                if (modernStart) {
                    context.mcpReq.signal.throwIfAborted();
                    context.mcpReq.signal.addEventListener('abort', startAborted, { once: true });
                }
                const requestContext = client.request({
                    requestId: context.mcpReq.id,
                    capabilities: supported,
                    waitSignal: AbortSignal.any([
                        lifetime.signal,
                        modernStart ? startLifetime.signal : context.mcpReq.signal,
                        ...(options.legacyLifetime ? [options.legacyLifetime()] : []),
                    ]),
                    readRoots: modern
                        ? async () => structuredClone(roots)
                        : (signal) => context.mcpReq.send({ method: 'roots/list' }, signal ? { signal } : {}),
                    elicit: (params, signal) => {
                        if (modern) throw new RequestFailure('CLIENT_CONTEXT_UNAVAILABLE');
                        return context.mcpReq.send({ method: 'elicitation/create', params }, signal ? { signal } : {});
                    },
                    onProgress: (progress) => {
                        if (token !== undefined && (!modern || requestActive))
                            void context.mcpReq
                                .notify({
                                    method: 'notifications/progress',
                                    params: { ...progress, progressToken: token },
                                })
                                .catch(() => {});
                    },
                });
                if (control) {
                    try {
                        const result = await core.control(control, requestContext);
                        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
                    } finally {
                        requestActive = false;
                        context.mcpReq.signal.removeEventListener('abort', startAborted);
                    }
                }
                if (!core.tools.some((tool) => tool.name === name)) throw new Error('Unknown tool.');
                const official = parseRegisteredOfficialArguments(arguments_);
                return await core.invoke(name, { ...official.arguments, _dct: official.route }, requestContext);
            } catch (error) {
                if (authenticated && error instanceof RequestFailure)
                    throw new ProtocolError(ProtocolErrorCode.InvalidParams, requestFailureExplanation(error), {
                        code: error.code,
                    });
                throw new ProtocolError(
                    ProtocolErrorCode.InvalidParams,
                    'Request rejected. Check the registration bearer, current route and validated tool arguments.',
                );
            }
        });
        return server;
    }
    return {
        createServer,
        close() {
            lifetime.abort(new Error('The MCP service closed.'));
        },
    };
}
