import { isRecord } from '../shared/errors.ts';

export type TargetKind = 'chrome' | 'generic-cdp';
export type Disposition = 'Close' | 'Keep';
export interface LaunchOptions {
    launchCommand: string;
    targetKind?: TargetKind;
    basePort?: number;
    exactPort?: number;
    profileKey?: string;
    launchDefinition?: { executablePath: string; arguments: string[]; cwd: string };
}
export type ControlRequest =
    | { action: 'status'; entryId: string; connectionId?: string }
    | { action: 'start'; entryId: string; launchCommand: string; targetKind?: TargetKind; basePort?: number }
    | { action: 'restart' | 'end-task'; entryId: string; connectionId: string; sessionId: string }
    | { action: 'stop'; entryId: string; connectionId: string; sessionId: string; disposition: Disposition };
export interface TargetStatus {
    entryId: string;
    status: 'idle' | 'active' | 'lost' | 'closing' | 'close-failed';
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
}
export interface GatewayStatus {
    entryId: string;
    connections: ConnectionStatus[];
}
export type ControlResult = GatewayStatus | ConnectionStatus;
export type ControlResponse =
    | { ok: true; result: ControlResult }
    | { ok: false; error: string; details?: Record<string, unknown> };
export interface ControlHandler {
    status(connectionId?: string): ControlResult;
    start(options: LaunchOptions): Promise<ConnectionStatus>;
    restart(options: { connectionId: string; sessionId: string }): Promise<ConnectionStatus>;
    stop(options: { connectionId: string; sessionId: string; disposition: Disposition }): Promise<ConnectionStatus>;
    endTask(options: { connectionId: string; sessionId: string }): Promise<ConnectionStatus>;
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
function validPort(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}
export function parseControlRequest(value: unknown): ControlRequest {
    if (!isRecord(value)) throw new Error('Invalid control request.');
    validateIdentity(value.entryId, 'entry ID');
    const entryId = value.entryId;
    const action = value.action;
    if (action === 'status') {
        fields(value, ['action', 'entryId', 'connectionId']);
        if (value.connectionId !== undefined) validateIdentity(value.connectionId, 'connection ID');
        return { action, entryId, ...(value.connectionId === undefined ? {} : { connectionId: value.connectionId }) };
    }
    if (action === 'start') {
        fields(value, ['action', 'entryId', 'launchCommand', 'targetKind', 'basePort']);
        if (typeof value.launchCommand !== 'string' || !value.launchCommand.trim())
            throw new Error('A launch command is required.');
        if (value.targetKind !== undefined && value.targetKind !== 'chrome' && value.targetKind !== 'generic-cdp')
            throw new Error('Unknown target kind.');
        if (value.basePort !== undefined && !validPort(value.basePort)) throw new Error('Base port is invalid.');
        return {
            action,
            entryId,
            launchCommand: value.launchCommand,
            ...(value.targetKind === undefined ? {} : { targetKind: value.targetKind }),
            ...(value.basePort === undefined ? {} : { basePort: value.basePort }),
        };
    }
    if (action !== 'restart' && action !== 'stop' && action !== 'end-task') throw new Error('Unknown control action.');
    fields(value, ['action', 'entryId', 'connectionId', 'sessionId', ...(action === 'stop' ? ['disposition'] : [])]);
    validateIdentity(value.connectionId, 'connection ID');
    validateIdentity(value.sessionId, 'session ID');
    if (action === 'stop') {
        if (value.disposition !== 'Close' && value.disposition !== 'Keep') throw new Error('Choose Close or Keep.');
        return {
            action,
            entryId,
            connectionId: value.connectionId,
            sessionId: value.sessionId,
            disposition: value.disposition,
        };
    }
    return { action, entryId, connectionId: value.connectionId, sessionId: value.sessionId };
}
export function parseControlResponse(value: unknown): ControlResponse {
    if (!isRecord(value)) throw new Error('Invalid control response.');
    if (value.ok === false && typeof value.error === 'string') {
        fields(value, ['ok', 'error', 'details']);
        if (value.details !== undefined && !isRecord(value.details)) throw new Error('Invalid error details.');
        return { ok: false, error: value.error, ...(value.details === undefined ? {} : { details: value.details }) };
    }
    fields(value, ['ok', 'result']);
    const result = value.result;
    if (value.ok !== true || !isRecord(result)) throw new Error('Invalid control result.');
    if ('connections' in result) {
        fields(result, ['entryId', 'connections']);
        validateIdentity(result.entryId, 'entry ID');
        if (!Array.isArray(result.connections)) throw new Error('Invalid connection list.');
        const connections = result.connections.map((connection: unknown) => {
            const parsed = parseControlResponse({ ok: true, result: connection });
            if (!parsed.ok || !('connectionId' in parsed.result) || parsed.result.entryId !== result.entryId)
                throw new Error('Invalid connection identity.');
            return parsed.result;
        });
        if (new Set(connections.map((connection) => connection.connectionId)).size !== connections.length)
            throw new Error('Duplicate connection identity.');
        return { ok: true, result: { entryId: result.entryId, connections } };
    }
    fields(result, [
        'entryId',
        'connectionId',
        'status',
        'sessionId',
        'port',
        'processId',
        'targetKind',
        'reason',
        'taskActive',
        'disposition',
        'pageIdsInvalidated',
    ]);
    validateIdentity(result.entryId, 'entry ID');
    validateIdentity(result.connectionId, 'connection ID');
    if (!['idle', 'active', 'lost', 'closing', 'close-failed'].includes(String(result.status)))
        throw new Error('Invalid target status.');
    if (result.status !== 'idle' || result.sessionId !== undefined) validateIdentity(result.sessionId, 'session ID');
    if ((result.status !== 'idle' || result.port !== undefined) && !validPort(result.port))
        throw new Error('Invalid target port.');
    if (
        (result.status !== 'idle' || result.processId !== undefined) &&
        (typeof result.processId !== 'number' || !Number.isSafeInteger(result.processId) || result.processId < 1)
    )
        throw new Error('Invalid target process ID.');
    if (
        (result.status !== 'idle' || result.targetKind !== undefined) &&
        result.targetKind !== 'chrome' &&
        result.targetKind !== 'generic-cdp'
    )
        throw new Error('Invalid target kind.');
    if (result.reason !== undefined && typeof result.reason !== 'string') throw new Error('Invalid target reason.');
    if (result.disposition !== undefined && result.disposition !== 'Close' && result.disposition !== 'Keep')
        throw new Error('Invalid disposition.');
    for (const key of ['taskActive', 'pageIdsInvalidated'])
        if (result[key] !== undefined && typeof result[key] !== 'boolean') throw new Error('Invalid target marker.');
    return { ok: true, result: result as Record<string, unknown> & ControlResult };
}
