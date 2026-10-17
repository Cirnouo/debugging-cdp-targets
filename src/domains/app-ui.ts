import { isRecord } from '../shared/errors.ts';
import { type AppConfiguration, type AppConfigurationState, parseAppConfiguration } from './app-configuration.ts';
import { type ConnectionRoute, parseConnectionRoute, type RestartScope, validateIdentity } from './control-contract.ts';
import type { DataIsolationEvidence } from './data-isolation.ts';
import type { PluginHost } from './host-management.ts';

export const APP_UI_URL = 'dct-app://manager/';
export const APP_MANAGEMENT_CHANNEL = 'dct-app:manage';
const APP_ASSET_PATHS = ['/', '/app-renderer.js', '/app.css', '/icon.png'] as const;

export function appAssetPath(input: string, method: string, initiatorOrigin: unknown) {
    try {
        const url = new URL(input);
        if (
            method !== 'GET' ||
            url.protocol !== 'dct-app:' ||
            url.host !== 'manager' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            (initiatorOrigin !== undefined && initiatorOrigin !== 'dct-app://manager')
        )
            return undefined;
        return APP_ASSET_PATHS.find((candidate) => candidate === url.pathname);
    } catch {
        return undefined;
    }
}
export type AppUiRequest =
    | Readonly<{ action: 'inspect' | 'quit' | 'restart' }>
    | Readonly<{ action: 'configure'; configuration: AppConfiguration }>
    | Readonly<{ action: 'manage'; command: AppManagementCommand }>;
export type AppManagementCommand =
    | { kind: 'restart'; route: ConnectionRoute; scope: RestartScope }
    | { kind: 'close'; routes: ConnectionRoute[] }
    | { kind: 'transfer'; routes: ConnectionRoute[]; registrationId: string }
    | { kind: 'unregister'; registrationId: string }
    | { kind: 'connection'; route: ConnectionRoute }
    | { kind: 'operation-status'; operationId: string }
    | { kind: 'operation-cancel'; operationId: string }
    | { kind: 'operation-wait'; operationId: string; cursor: number }
    | { kind: 'host-inspect'; host: PluginHost }
    | { kind: 'host-sync'; host: PluginHost };
export type AppRegistrationSummary = { registrationId: string; resources: number; jobs: number };
export type AppConnectionSummary = {
    connectionId: string;
    sessionId?: string;
    registrationId?: string;
    status: string;
    upstreamStatus?: string;
    establishedAt?: number;
    lastRealOperationAt?: number;
    targetGeneration: string;
    officialGeneration: string;
    processId?: number;
    port?: number;
};
export type AppOperationSummary = {
    operationId: string;
    requestId: string;
    registrationId?: string;
    connectionId?: string;
    sessionId?: string;
    action?: string;
    state: 'accepted' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
    phase: string;
    elapsedMs: number;
    cursor: number;
};
export type AppHostSummary = {
    host: PluginHost;
    state:
        | 'not-checked'
        | 'no-candidate'
        | 'app-update-required'
        | 'invalid-record'
        | 'read-only'
        | 'inspected'
        | 'failed'
        | 'partial-failure'
        | 'newer-installed'
        | 'busy'
        | 'disk-synchronized';
    activation: 'unverified' | 'reload-pending';
    candidate?: 'no-candidate' | 'app-update-required' | 'newer-installed';
    reason?: string;
    version?: string;
    installations?: {
        version: string;
        scope: string;
        enabled: boolean;
        pathResolved: boolean;
        readOnlyReason?: string;
    }[];
};
export type AppManagementSnapshot = {
    registrations: AppRegistrationSummary[];
    connections: AppConnectionSummary[];
    operations: AppOperationSummary[];
    hosts: AppHostSummary[];
    selected?: {
        connectionId: string;
        sessionId: string;
        enabledTools: string[];
        mcpArgs: string[];
        launch?: {
            executable: string;
            arguments: string[];
            cwd?: string;
            environmentNames: string[];
            portPolicy?: 'fixed' | 'automatic';
        };
        isolation?: DataIsolationEvidence;
    };
    outcomes?: {
        connectionId: string;
        state: 'accepted' | 'transferred' | 'failed';
        operationId?: string;
        reason?: 'busy' | 'stale' | 'rejected';
    }[];
};
export type AppUiSnapshot = Readonly<{
    phase: 'starting' | 'ready' | 'closing' | 'failed';
    configuration?: AppConfigurationState;
    message?: string;
    exitIntent?: 'quit' | 'restart';
    management?: AppManagementSnapshot;
}>;
export type AppUiBridge = Readonly<{
    inspect(): Promise<AppUiSnapshot>;
    configure(configuration: AppConfiguration): Promise<AppUiSnapshot>;
    manage(command: AppManagementCommand): Promise<AppUiSnapshot>;
    quit(): Promise<void>;
    restart(): Promise<void>;
}>;

function fields(
    value: unknown,
    required: readonly string[],
    optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
    if (
        !isRecord(value) ||
        required.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
    )
        throw new Error('Invalid management message.');
}

export function parseAppUiRequest(value: unknown): AppUiRequest {
    if (!isRecord(value)) throw new Error('Invalid management request.');
    if (value.action === 'configure') {
        fields(value, ['action', 'configuration']);
        return Object.freeze({ action: 'configure', configuration: parseAppConfiguration(value.configuration) });
    }
    if (value.action === 'manage') {
        fields(value, ['action', 'command']);
        return { action: 'manage', command: parseAppManagementCommand(value.command) };
    }
    fields(value, ['action']);
    if (value.action !== 'inspect' && value.action !== 'quit' && value.action !== 'restart')
        throw new Error('Unsupported management action.');
    return Object.freeze({ action: value.action });
}

export function parseAppManagementCommand(input: unknown): AppManagementCommand {
    if (!isRecord(input)) throw new Error('Invalid management command.');
    const id = (value: unknown) => {
        validateIdentity(value, 'management identity');
        return value;
    };
    const routes = (value: unknown) => {
        if (!Array.isArray(value) || value.length < 1 || value.length > 256)
            throw new Error('Select between 1 and 256 connections.');
        const result = value.map(parseConnectionRoute);
        if (new Set(result.map((route) => route.connectionId)).size !== result.length)
            throw new Error('Duplicate connection.');
        return result;
    };
    switch (input.kind) {
        case 'restart':
            fields(input, ['kind', 'route', 'scope']);
            if (input.scope !== 'target' && input.scope !== 'official' && input.scope !== 'both')
                throw new Error('Choose a restart scope.');
            return { kind: input.kind, route: parseConnectionRoute(input.route), scope: input.scope };
        case 'connection':
            fields(input, ['kind', 'route']);
            return { kind: input.kind, route: parseConnectionRoute(input.route) };
        case 'close':
            fields(input, ['kind', 'routes']);
            return { kind: input.kind, routes: routes(input.routes) };
        case 'transfer':
            fields(input, ['kind', 'routes', 'registrationId']);
            return { kind: input.kind, routes: routes(input.routes), registrationId: id(input.registrationId) };
        case 'unregister':
            fields(input, ['kind', 'registrationId']);
            return { kind: input.kind, registrationId: id(input.registrationId) };
        case 'operation-status':
        case 'operation-cancel':
            fields(input, ['kind', 'operationId']);
            return { kind: input.kind, operationId: id(input.operationId) };
        case 'operation-wait':
            fields(input, ['kind', 'operationId', 'cursor']);
            if (typeof input.cursor !== 'number' || !Number.isSafeInteger(input.cursor) || input.cursor < 0)
                throw new Error('Invalid operation cursor.');
            return { kind: input.kind, operationId: id(input.operationId), cursor: input.cursor };
        case 'host-inspect':
        case 'host-sync':
            fields(input, ['kind', 'host']);
            if (input.host !== 'codex' && input.host !== 'claude') throw new Error('Invalid host.');
            return { kind: input.kind, host: input.host };
        default:
            throw new Error('Unsupported management command.');
    }
}

export function formatAppElapsed(timestamp: unknown, now: number): string {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0 || !Number.isFinite(now))
        return 'Unavailable';
    const seconds = Math.floor(Math.max(0, now - timestamp) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
}

function text(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 8192 || /[\x00-\x1f]/.test(value))
        throw new Error('Invalid management text.');
    return value;
}
function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid management count.');
    return value;
}
function identities(value: Record<string, unknown>, required: string[], optional: string[] = []) {
    for (const key of required) validateIdentity(value[key], key);
    for (const key of optional) if (Object.hasOwn(value, key)) validateIdentity(value[key], key);
}
function collection(value: unknown, validate: (item: unknown) => void) {
    if (!Array.isArray(value)) throw new Error('Invalid management collection.');
    for (const item of value) validate(item);
}
export function parseAppManagementSnapshot(value: unknown): AppManagementSnapshot {
    fields(value, ['registrations', 'connections', 'operations', 'hosts'], ['selected', 'outcomes']);
    collection(value.registrations, (item) => {
        fields(item, ['registrationId', 'resources', 'jobs']);
        identities(item, ['registrationId']);
        count(item.resources);
        count(item.jobs);
    });
    collection(value.connections, (item) => {
        fields(
            item,
            ['connectionId', 'status', 'targetGeneration', 'officialGeneration'],
            [
                'sessionId',
                'registrationId',
                'upstreamStatus',
                'establishedAt',
                'lastRealOperationAt',
                'processId',
                'port',
            ],
        );
        identities(item, ['connectionId', 'targetGeneration', 'officialGeneration'], ['sessionId', 'registrationId']);
        if (!['idle', 'starting', 'active', 'lost', 'closing', 'close-failed'].includes(text(item.status)))
            throw new Error('Invalid connection status.');
        if (
            item.upstreamStatus !== undefined &&
            !['connected', 'disconnected', 'quarantined'].includes(text(item.upstreamStatus))
        )
            throw new Error('Invalid upstream status.');
        for (const key of ['establishedAt', 'lastRealOperationAt', 'processId', 'port'])
            if (item[key] !== undefined) count(item[key]);
    });
    collection(value.operations, (item) => {
        fields(
            item,
            ['operationId', 'requestId', 'state', 'phase', 'elapsedMs', 'cursor'],
            ['registrationId', 'connectionId', 'sessionId', 'action'],
        );
        identities(item, ['operationId'], ['registrationId', 'connectionId', 'sessionId']);
        text(item.requestId);
        text(item.phase);
        count(item.elapsedMs);
        count(item.cursor);
        if (!['accepted', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled'].includes(text(item.state)))
            throw new Error('Invalid operation state.');
        if (item.action !== undefined && !['start', 'restart', 'stop'].includes(text(item.action)))
            throw new Error('Invalid operation action.');
    });
    collection(value.hosts, (item) => {
        fields(item, ['host', 'state', 'activation'], ['candidate', 'reason', 'version', 'installations']);
        if (
            !['codex', 'claude'].includes(text(item.host)) ||
            ![
                'not-checked',
                'no-candidate',
                'app-update-required',
                'invalid-record',
                'read-only',
                'inspected',
                'failed',
                'partial-failure',
                'newer-installed',
                'busy',
                'disk-synchronized',
            ].includes(text(item.state)) ||
            !['unverified', 'reload-pending'].includes(text(item.activation))
        )
            throw new Error('Invalid host state.');
        if (
            item.candidate !== undefined &&
            !['no-candidate', 'app-update-required', 'newer-installed'].includes(text(item.candidate))
        )
            throw new Error('Invalid host candidate.');
        for (const key of ['reason', 'version']) if (item[key] !== undefined) text(item[key]);
        if (item.installations !== undefined)
            collection(item.installations, (installation) => {
                fields(installation, ['version', 'scope', 'enabled', 'pathResolved'], ['readOnlyReason']);
                text(installation.version);
                text(installation.scope);
                if (typeof installation.enabled !== 'boolean' || typeof installation.pathResolved !== 'boolean')
                    throw new Error('Invalid installation state.');
                if (installation.readOnlyReason !== undefined) text(installation.readOnlyReason);
            });
    });
    if (value.selected !== undefined) {
        fields(value.selected, ['connectionId', 'sessionId', 'enabledTools', 'mcpArgs'], ['launch', 'isolation']);
        identities(value.selected, ['connectionId', 'sessionId']);
        collection(value.selected.enabledTools, text);
        collection(value.selected.mcpArgs, text);
        if (value.selected.launch !== undefined) {
            const launch = value.selected.launch;
            fields(launch, ['executable', 'arguments', 'environmentNames'], ['cwd', 'portPolicy']);
            text(launch.executable);
            if (launch.cwd !== undefined) text(launch.cwd);
            collection(launch.environmentNames, text);
            collection(launch.arguments, (argument) => {
                if (typeof argument !== 'string' || argument.length > 32768 || argument.includes('\0'))
                    throw new Error('Invalid launch argument.');
            });
            if (launch.portPolicy !== undefined && launch.portPolicy !== 'fixed' && launch.portPolicy !== 'automatic')
                throw new Error('Invalid port policy.');
        }
        if (value.selected.isolation !== undefined) {
            const isolation = value.selected.isolation;
            if (!isRecord(isolation)) throw new Error('Invalid isolation evidence.');
            if (isolation.mode === 'none') fields(isolation, ['mode']);
            else {
                fields(isolation, ['mode', 'path', 'cleanup', 'state'], ['nonempty']);
                if (
                    isolation.mode !== 'data-dir' ||
                    !['retain', 'delete-on-release'].includes(text(isolation.cleanup)) ||
                    !['held', 'retained', 'deleted', 'cleanup-failed'].includes(text(isolation.state))
                )
                    throw new Error('Invalid isolation evidence.');
                text(isolation.path);
                if (isolation.nonempty !== undefined && typeof isolation.nonempty !== 'boolean')
                    throw new Error('Invalid isolation evidence.');
            }
        }
    }
    if (value.outcomes !== undefined)
        collection(value.outcomes, (item) => {
            fields(item, ['connectionId', 'state'], ['operationId', 'reason']);
            identities(item, ['connectionId'], ['operationId']);
            if (!['accepted', 'transferred', 'failed'].includes(text(item.state)))
                throw new Error('Invalid batch outcome.');
            if (item.reason !== undefined && !['busy', 'stale', 'rejected'].includes(text(item.reason)))
                throw new Error('Invalid batch reason.');
        });
    // Validation above proves this closed transport shape; clone avoids sharing the core's mutable objects.
    return structuredClone(value) as AppManagementSnapshot;
}

export function parseAppUiSnapshot(value: unknown): AppUiSnapshot {
    fields(value, ['phase'], ['configuration', 'message', 'management', 'exitIntent']);
    if (value.phase !== 'starting' && value.phase !== 'ready' && value.phase !== 'closing' && value.phase !== 'failed')
        throw new Error('Invalid App management phase.');
    let configuration: AppConfigurationState | undefined;
    if (Object.hasOwn(value, 'configuration')) {
        fields(value.configuration, ['desired', 'effective', 'restartRequired']);
        const desired = parseAppConfiguration(value.configuration.desired);
        const effective = parseAppConfiguration(value.configuration.effective);
        if (
            value.configuration.restartRequired !== (desired.port !== effective.port) ||
            desired.appearance !== effective.appearance ||
            JSON.stringify(desired.hosts) !== JSON.stringify(effective.hosts)
        )
            throw new Error('Inconsistent App management settings.');
        configuration = Object.freeze({ desired, effective, restartRequired: desired.port !== effective.port });
    }
    if (value.phase === 'ready' && configuration === undefined)
        throw new Error('Ready App phase requires configuration.');
    if (
        value.message !== undefined &&
        (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 500)
    )
        throw new Error('Invalid App management message.');
    if (value.phase === 'failed' && value.message === undefined)
        throw new Error('Failed App phase requires an explanation.');
    if (
        value.exitIntent !== undefined &&
        (value.phase !== 'closing' || (value.exitIntent !== 'quit' && value.exitIntent !== 'restart'))
    )
        throw new Error('Invalid App exit intent.');
    return Object.freeze({
        phase: value.phase,
        ...(configuration === undefined ? {} : { configuration }),
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
        ...(value.exitIntent === 'quit' || value.exitIntent === 'restart' ? { exitIntent: value.exitIntent } : {}),
        ...(value.management === undefined ? {} : { management: parseAppManagementSnapshot(value.management) }),
    });
}
