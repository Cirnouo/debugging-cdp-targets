import { createHash, randomBytes } from 'node:crypto';
import type {
    CallToolResult,
    ElicitRequestFormParams,
    ElicitResult,
    ListRootsResult,
    Progress,
    Tool,
} from '@modelcontextprotocol/client';
import { getSupportedElicitationModes } from '@modelcontextprotocol/client';
import { ClientCapabilitiesSchema, ElicitResultSchema, ListRootsResultSchema } from '@modelcontextprotocol/core';
import {
    acceptedContent,
    CLIENT_CAPABILITIES_META_KEY,
    createRequestStateCodec,
    fromJsonSchema,
    inputRequired,
    type JsonSchemaType,
    ProtocolError,
    ProtocolErrorCode,
    Server,
    type ServerContext,
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
type FormState = Omit<RootsState, 'phase'> & {
    phase: 'form';
    flowId: string;
    round: number;
    key: string;
    route: string;
};
type PendingForm = {
    key: string;
    round: number;
    params: ElicitRequestFormParams;
    resolve: (answer: ElicitResult) => void;
    reject: (error: unknown) => void;
};
type Channel = { context: ServerContext; token: string | number | undefined; detach(): void };
type Flow = {
    id: string;
    registrationId: string;
    name: string;
    fingerprint: string;
    route: string;
    capabilities: ClientRequestFacilities['capabilities'];
    lifetime: AbortController;
    execution: Promise<CallToolResult>;
    settled: boolean;
    round: number;
    expires?: number;
    pending?: PendingForm;
    channel?: Channel;
    timer?: ReturnType<typeof setTimeout>;
    changed: Promise<void>;
    wake(): void;
};

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

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
    const flows = new Map<string, Flow>();
    const codec = createRequestStateCodec<RootsState | FormState>({
        key: randomBytes(32),
        ttlSeconds: 600,
        bind: (context) => context.mcpReq.method,
    });
    function retire(flow: Flow, reason = new Error('The originating input context is unavailable.')) {
        if (flows.get(flow.id) !== flow) return;
        flows.delete(flow.id);
        flow.channel?.detach();
        if (flow.timer) clearTimeout(flow.timer);
        flow.lifetime.abort(reason);
        flow.pending?.reject(reason);
        flow.wake();
    }
    function changed(flow: Flow) {
        flow.wake();
        const next = deferred<void>();
        flow.changed = next.promise;
        flow.wake = () => next.resolve();
    }
    function progress(flow: Flow, value: Progress) {
        const channel = flow.channel;
        if (channel && channel.token !== undefined && !flow.lifetime.signal.aborted)
            void channel.context.mcpReq
                .notify({ method: 'notifications/progress', params: { ...value, progressToken: channel.token } })
                .catch(() => {});
    }
    function elicit(flow: Flow, params: ElicitRequestFormParams, signal?: AbortSignal) {
        flow.lifetime.signal.throwIfAborted();
        signal?.throwIfAborted();
        if (!flow.capabilities.formElicitation) throw new RequestFailure('FORM_ELICITATION_UNAVAILABLE');
        if (flow.pending || flow.round >= 8) throw new Error('The bounded form input context is unavailable.');
        flow.expires ??= Date.now() + 600_000;
        if (flow.expires <= Date.now()) throw new Error('The form input context expired.');
        const answer = deferred<ElicitResult>();
        const pending = {
            key: `form${++flow.round}`,
            round: flow.round,
            params: structuredClone(params),
            resolve: answer.resolve,
            reject: answer.reject,
        };
        flow.pending = pending;
        changed(flow);
        const aborted = () => retire(flow);
        signal?.addEventListener('abort', aborted, { once: true });
        return answer.promise.finally(() => signal?.removeEventListener('abort', aborted));
    }
    async function exchange(flow: Flow, context: ServerContext, token: string | number | undefined, state?: FormState) {
        if (flow.channel || flow.lifetime.signal.aborted) throw new Error('The input round is unavailable.');
        const aborted = () => retire(flow);
        const channel: Channel = {
            context,
            token,
            detach() {
                context.mcpReq.signal.removeEventListener('abort', aborted);
                if (flow.channel === channel) delete flow.channel;
            },
        };
        flow.channel = channel;
        context.mcpReq.signal.addEventListener('abort', aborted, { once: true });
        if (context.mcpReq.signal.aborted) aborted();
        try {
            if (state) {
                const pending = flow.pending;
                if (!pending || pending.round !== state.round || pending.key !== state.key)
                    throw new Error('The input round was already consumed.');
                const value = context.mcpReq.inputResponses?.[pending.key];
                if (value !== undefined) {
                    const checked = await ElicitResultSchema['~standard'].validate(value);
                    if (checked.issues) throw new Error('Invalid form response.');
                    if (
                        checked.value.action === 'accept' &&
                        acceptedContent(
                            context.mcpReq.inputResponses,
                            pending.key,
                            fromJsonSchema(pending.params.requestedSchema as JsonSchemaType),
                        ) === undefined
                    )
                        throw new Error('Invalid form content.');
                    if (flow.timer) clearTimeout(flow.timer);
                    delete flow.timer;
                    delete flow.pending;
                    pending.resolve(checked.value);
                }
            }
            while (true) {
                flow.lifetime.signal.throwIfAborted();
                if (flow.pending) {
                    const pending = flow.pending;
                    const next: FormState = {
                        version: 1,
                        phase: 'form',
                        registrationId: flow.registrationId,
                        name: flow.name,
                        fingerprint: flow.fingerprint,
                        expires: flow.expires ?? Date.now(),
                        flowId: flow.id,
                        round: pending.round,
                        key: pending.key,
                        route: flow.route,
                    };
                    const requestState = await codec.mint(next, context);
                    if (!flow.timer) {
                        flow.timer = setTimeout(() => retire(flow), Math.max(0, next.expires - Date.now()));
                        flow.timer.unref();
                    }
                    // SDK completion closes this Server. Remove that exchange's signal before returning input_required.
                    channel.detach();
                    return inputRequired({
                        inputRequests: { [pending.key]: inputRequired.elicit(pending.params) },
                        requestState,
                    });
                }
                const result = await Promise.race([
                    flow.execution.then((value) => ({ kind: 'result' as const, value })),
                    flow.changed.then(() => ({ kind: 'changed' as const })),
                ]);
                if (result.kind === 'result') {
                    channel.detach();
                    retire(flow);
                    return result.value;
                }
            }
        } catch (error) {
            // Invalid input can be corrected with the same unconsumed round; a true signal abort retires the holder.
            channel.detach();
            if (flow.settled || context.mcpReq.signal.aborted) retire(flow);
            throw error;
        }
    }
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
                const state = context.mcpReq.requestState<RootsState | FormState>();
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
                } else if (state && !(modern && !control && state.phase === 'form'))
                    throw new Error('Unexpected continuation.');
                const token = request.params._meta?.progressToken;
                if (modern && !control) {
                    if (!core.tools.some((tool) => tool.name === name)) throw new Error('Unknown tool.');
                    const official = parseRegisteredOfficialArguments(arguments_);
                    const hash = fingerprint({ arguments: official.arguments, route: official.route });
                    const route = fingerprint(official.route);
                    if (state) {
                        if (
                            state.phase !== 'form' ||
                            state.version !== 1 ||
                            state.registrationId !== principal.registrationId ||
                            state.name !== name ||
                            state.fingerprint !== hash ||
                            state.route !== route ||
                            state.expires <= Date.now()
                        )
                            throw new Error('Invalid form continuation.');
                        const flow = flows.get(state.flowId);
                        if (
                            !flow ||
                            flow.registrationId !== state.registrationId ||
                            flow.name !== name ||
                            flow.fingerprint !== hash ||
                            flow.route !== route ||
                            flow.expires !== state.expires ||
                            !supported.formElicitation ||
                            !flow.capabilities.formElicitation ||
                            (flow.capabilities.roots && !supported.roots)
                        )
                            throw new Error('The originating input context is unavailable.');
                        return await exchange(flow, context, token, state);
                    }
                    if (context.mcpReq.inputResponses) throw new Error('A signed continuation is required.');
                    const wake = deferred<void>();
                    const flow: Flow = {
                        id: randomBytes(24).toString('base64url'),
                        registrationId: principal.registrationId,
                        name,
                        fingerprint: hash,
                        route,
                        capabilities: supported,
                        lifetime: new AbortController(),
                        execution: Promise.resolve({ content: [] }),
                        settled: false,
                        round: 0,
                        changed: wake.promise,
                        wake: () => wake.resolve(),
                    };
                    flows.set(flow.id, flow);
                    const logicalContext = client.request({
                        requestId: context.mcpReq.id,
                        capabilities: supported,
                        waitSignal: flow.lifetime.signal,
                        onProgress: (value) => progress(flow, value),
                        elicit: (params, signal) => elicit(flow, params, signal),
                    });
                    flow.execution = Promise.resolve()
                        .then(() => core.invoke(name, { ...official.arguments, _dct: official.route }, logicalContext))
                        .finally(() => {
                            flow.settled = true;
                            if (!flow.channel) retire(flow);
                        });
                    return await exchange(flow, context, token);
                }
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
            for (const flow of flows.values()) retire(flow);
        },
    };
}
