import type { Diagnostic } from '../shared/diagnostics.ts';
import { isRecord } from '../shared/errors.ts';
import { type ApplicationLaunch, type LaunchDefinition, parseApplicationLaunch } from './launch-command.ts';

export type TargetKind = 'chrome' | 'generic-cdp';
export type Disposition = 'Close' | 'Keep';
export interface LaunchOptions {
    launch: ApplicationLaunch;
    targetKind?: TargetKind;
    basePort?: number;
    exactPort?: number;
    launchDefinition?: LaunchDefinition;
    mcpArgs?: string[];
}
export interface LaunchContext {
    signal?: AbortSignal;
    onPhase?: (phase: string) => void;
}
export interface ControlContext extends LaunchContext {
    onIdentity?: (identity: ConnectionRoute) => void;
}
export type ControlRequest =
    | { action: 'status'; entryId?: string; connectionId?: string; operationId?: string; toolNames?: string[] }
    | ({ action: 'start'; entryId: string; requestId: string } & Pick<
          LaunchOptions,
          'launch' | 'targetKind' | 'basePort' | 'mcpArgs'
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
export interface ConnectionStatus extends TargetStatus {
    connectionId: string;
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
export function parseControlRequest(value: unknown): ControlRequest {
    if (!isRecord(value)) throw new Error('Invalid control request.');
    const action = value.action;
    if (action === 'status') {
        fields(value, ['action', 'entryId', 'connectionId', 'operationId', 'toolNames']);
        if (Object.keys(value).length === 1) return { action };
        validateIdentity(value.entryId, 'entry ID');
        if (value.connectionId !== undefined) validateIdentity(value.connectionId, 'connection ID');
        if (value.operationId !== undefined) validateIdentity(value.operationId, 'operation ID');
        if (value.connectionId !== undefined && value.operationId !== undefined)
            throw new Error('Select a connection or an operation, not both.');
        return {
            action,
            entryId: value.entryId,
            ...(value.connectionId === undefined ? {} : { connectionId: value.connectionId }),
            ...(value.operationId === undefined ? {} : { operationId: value.operationId }),
            ...(value.toolNames === undefined ? {} : { toolNames: strings(value.toolNames) }),
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
        fields(value, ['action', 'entryId', 'requestId', 'launch', 'targetKind', 'basePort', 'mcpArgs']);
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
