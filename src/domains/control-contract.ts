import type { Diagnostic } from '../shared/diagnostics.ts';
import { isRecord } from '../shared/errors.ts';
import { type DataIsolation, type DataIsolationEvidence, parseDataIsolation } from './data-isolation.ts';
import { type ApplicationLaunch, type LaunchDefinition, parseApplicationLaunch } from './launch-command.ts';

export type TargetKind = 'chrome' | 'generic-cdp';
export type Disposition = 'Close' | 'Keep';
export type StatusInclude = 'configuration' | 'diagnostics';
export type UpstreamStatus = 'connected' | 'disconnected' | 'quarantined';
export interface LaunchOptions {
    launch: ApplicationLaunch;
    isolation: DataIsolation;
    targetKind?: TargetKind;
    basePort?: number;
    exactPort?: number;
    launchDefinition?: LaunchDefinition;
    mcpArgs?: string[];
}
export interface LaunchContext {
    signal?: AbortSignal;
    onPhase?: (phase: string) => void;
    dataDirectory?: string;
}
export interface ControlContext extends LaunchContext {
    operationId?: string;
    onIdentity?: (identity: ConnectionRoute) => void;
    onIsolation?: (isolation: DataIsolationEvidence) => void;
}
export type ControlRequest =
    | {
          action: 'status';
          entryId?: string;
          connectionId?: string;
          operationId?: string;
          toolNames?: string[];
          include?: StatusInclude[];
      }
    | ({ action: 'start'; entryId: string; requestId: string } & Pick<
          LaunchOptions,
          'launch' | 'isolation' | 'targetKind' | 'basePort' | 'mcpArgs'
      >)
    | ({ action: 'restart'; entryId: string; requestId: string; mcpArgs?: string[] } & ConnectionRoute)
    | ({ action: 'end-task'; entryId: string; requestId: string } & ConnectionRoute)
    | ({ action: 'stop'; entryId: string; requestId: string; disposition: Disposition } & ConnectionRoute)
    | { action: 'wait'; entryId: string; operationId: string; cursor?: number }
    | { action: 'cancel'; entryId: string; operationId: string };
export interface TargetStatus {
    entryId: string;
    status: 'idle' | 'starting' | 'active' | 'lost' | 'closing' | 'close-failed';
    sessionId?: string;
    port?: number;
    processId?: number;
    targetKind?: TargetKind;
    reason?: string;
    taskActive?: boolean;
    disposition?: Disposition;
    pageIdsInvalidated?: boolean;
}
export interface ConnectionSummary extends TargetStatus {
    connectionId: string;
    enabledToolCount?: number;
    upstreamStatus?: UpstreamStatus;
}
export interface ConnectionStatus extends ConnectionSummary {
    isolation?: DataIsolationEvidence;
    mcpArgs?: string[];
    enabledTools?: string[];
    workspace?: Record<string, unknown>;
    diagnostics?: (Diagnostic & { sessionId?: string })[];
}
export interface GatewayStatus {
    entryId: string;
    connections: ConnectionStatus[];
}
export type ControlResult = GatewayStatus | ConnectionStatus;
export interface ControlHandler {
    status(connectionId?: string): ControlResult;
    start(options: LaunchOptions, context?: ControlContext): Promise<ConnectionStatus>;
    restart(options: ConnectionRoute & { mcpArgs?: string[] }, context?: ControlContext): Promise<ConnectionStatus>;
    stop(options: ConnectionRoute & { disposition: Disposition }, context?: ControlContext): Promise<ConnectionStatus>;
    endTask(options: ConnectionRoute): Promise<ConnectionStatus>;
}

/** Default lifecycle output never contains configuration, tools, or diagnostics. */
export function connectionSummary(value: ConnectionStatus): ConnectionSummary {
    return {
        entryId: value.entryId,
        connectionId: value.connectionId,
        status: value.status,
        ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
        ...(value.port === undefined ? {} : { port: value.port }),
        ...(value.processId === undefined ? {} : { processId: value.processId }),
        ...(value.targetKind === undefined ? {} : { targetKind: value.targetKind }),
        ...(value.reason === undefined ? {} : { reason: value.reason }),
        ...(value.taskActive === undefined ? {} : { taskActive: value.taskActive }),
        ...(value.disposition === undefined ? {} : { disposition: value.disposition }),
        ...(value.pageIdsInvalidated === undefined ? {} : { pageIdsInvalidated: value.pageIdsInvalidated }),
        ...(value.enabledToolCount === undefined ? {} : { enabledToolCount: value.enabledToolCount }),
        ...(value.upstreamStatus === undefined ? {} : { upstreamStatus: value.upstreamStatus }),
    };
}

/** Retain retry and native failure evidence without nesting arbitrary status payloads. */
export function lifecycleFailureEvidence(value: Record<string, unknown>): Record<string, unknown> {
    const fields = new Set([
        'entryId',
        'connectionId',
        'sessionId',
        'status',
        'port',
        'processId',
        'targetKind',
        'reason',
        'taskActive',
        'disposition',
        'pageIdsInvalidated',
        'upstreamStatus',
        'phase',
        'code',
        'category',
        'nativeError',
        'exceptionType',
        'closeRequested',
        'processExited',
        'listenerState',
        'closeConfirmed',
        'cause',
        'catalogUpstreamRetained',
        'cleanupError',
        'executableClaim',
        'candidateCount',
        'matchCount',
    ]);
    const evidence = Object.fromEntries(
        Object.entries(value).filter(
            ([key, item]) =>
                fields.has(key) &&
                (typeof item === 'string' ||
                    typeof item === 'boolean' ||
                    (typeof item === 'number' && Number.isFinite(item))),
        ),
    );
    if (Array.isArray(value.retainedTargets))
        evidence.retainedTargets = value.retainedTargets
            .filter(isRecord)
            .map((target) =>
                Object.fromEntries(
                    ['processId', 'port'].flatMap((key) =>
                        typeof target[key] === 'number' && Number.isFinite(target[key]) ? [[key, target[key]]] : [],
                    ),
                ),
            );
    if (Array.isArray(value.mappedExecutablePaths))
        evidence.mappedExecutablePaths = value.mappedExecutablePaths
            .filter((item: unknown) => typeof item === 'string')
            .slice(0, 32);
    return evidence;
}

export function validateIdentity(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
        throw new Error(`A canonical lowercase UUID ${label} is required.`);
}
export type ConnectionRoute = { connectionId: string; sessionId: string };
export function parseConnectionRoute(value: unknown): ConnectionRoute {
    if (!isRecord(value)) throw new Error('A connection routing object is required.');
    fields(value, ['connectionId', 'sessionId']);
    validateIdentity(value.connectionId, 'connection ID');
    validateIdentity(value.sessionId, 'session ID');
    return { connectionId: value.connectionId, sessionId: value.sessionId };
}
function fields(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown control field.');
}
function strings(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === 'string' && !item.includes('\0')))
        throw new Error('Expected an array of strings.');
    return value;
}
function statusIncludes(value: unknown): StatusInclude[] {
    if (
        !Array.isArray(value) ||
        !value.every((item: unknown) => item === 'configuration' || item === 'diagnostics') ||
        new Set(value).size !== value.length
    )
        throw new Error('Status include accepts unique configuration and diagnostics values.');
    return value;
}
export function parseControlRequest(value: unknown): ControlRequest {
    if (!isRecord(value)) throw new Error('Invalid control request.');
    const action = value.action;
    if (action === 'status') {
        fields(value, ['action', 'entryId', 'connectionId', 'operationId', 'toolNames', 'include']);
        if (Object.keys(value).length === 1) return { action };
        validateIdentity(value.entryId, 'entry ID');
        if (value.connectionId !== undefined) validateIdentity(value.connectionId, 'connection ID');
        if (value.operationId !== undefined) validateIdentity(value.operationId, 'operation ID');
        if (
            value.operationId !== undefined &&
            (value.connectionId !== undefined || value.toolNames !== undefined || value.include !== undefined)
        )
            throw new Error('Operation status cannot also select a connection, tools, or includes.');
        if (value.include !== undefined && value.connectionId === undefined)
            throw new Error('Status include requires a selected connection.');
        return {
            action,
            entryId: value.entryId,
            ...(value.connectionId === undefined ? {} : { connectionId: value.connectionId }),
            ...(value.operationId === undefined ? {} : { operationId: value.operationId }),
            ...(value.toolNames === undefined ? {} : { toolNames: strings(value.toolNames) }),
            ...(value.include === undefined ? {} : { include: statusIncludes(value.include) }),
        };
    }
    validateIdentity(value.entryId, 'entry ID');
    const entryId = value.entryId;
    if (action === 'wait' || action === 'cancel') {
        fields(value, ['action', 'entryId', 'operationId', ...(action === 'wait' ? ['cursor'] : [])]);
        validateIdentity(value.operationId, 'operation ID');
        if (
            value.cursor !== undefined &&
            (typeof value.cursor !== 'number' || !Number.isSafeInteger(value.cursor) || value.cursor < 0)
        )
            throw new Error('Invalid event cursor.');
        return {
            action,
            entryId,
            operationId: value.operationId,
            ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
        };
    }
    if (
        typeof value.requestId !== 'string' ||
        !value.requestId.trim() ||
        value.requestId.length > 128 ||
        value.requestId.includes('\0')
    )
        throw new Error('A nonempty requestId of at most 128 characters is required.');
    const requestId = value.requestId;
    if (action === 'start') {
        fields(value, ['action', 'entryId', 'requestId', 'launch', 'isolation', 'targetKind', 'basePort', 'mcpArgs']);
        if (value.targetKind !== undefined && value.targetKind !== 'chrome' && value.targetKind !== 'generic-cdp')
            throw new Error('Unknown target kind.');
        if (
            value.basePort !== undefined &&
            (typeof value.basePort !== 'number' ||
                !Number.isInteger(value.basePort) ||
                value.basePort < 1 ||
                value.basePort > 65535)
        )
            throw new Error('Base port is invalid.');
        return {
            action,
            entryId,
            requestId,
            launch: parseApplicationLaunch(value.launch),
            isolation: parseDataIsolation(value.isolation),
            ...(value.targetKind === undefined ? {} : { targetKind: value.targetKind }),
            ...(value.basePort === undefined ? {} : { basePort: value.basePort }),
            ...(value.mcpArgs === undefined ? {} : { mcpArgs: strings(value.mcpArgs) }),
        };
    }
    if (action !== 'restart' && action !== 'stop' && action !== 'end-task') throw new Error('Unknown control action.');
    fields(value, [
        'action',
        'entryId',
        'requestId',
        'connectionId',
        'sessionId',
        ...(action === 'stop' ? ['disposition'] : []),
        ...(action === 'restart' ? ['mcpArgs'] : []),
    ]);
    const route = parseConnectionRoute({ connectionId: value.connectionId, sessionId: value.sessionId });
    if (action === 'stop') {
        if (value.disposition !== 'Close' && value.disposition !== 'Keep') throw new Error('Choose Close or Keep.');
        return { action, entryId, requestId, ...route, disposition: value.disposition };
    }
    if (action === 'restart')
        return {
            action,
            entryId,
            requestId,
            ...route,
            ...(value.mcpArgs === undefined ? {} : { mcpArgs: strings(value.mcpArgs) }),
        };
    return { action, entryId, requestId, ...route };
}
