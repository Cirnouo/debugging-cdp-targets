import { validateIdentity } from '../../domains/control-contract.ts';
import type { PluginHost } from '../../domains/host-management.ts';
import type { DataIsolationEvidence } from '../../gateway/targets/model/isolation.ts';
import { isRecord } from '../../shared/errors.ts';
import { type AppConfigurationState, parseAppConfiguration } from '../configuration/model.ts';

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

export const APP_OPERATION_FAILURE_VALUES = {
    kind: ['start-failed', 'restart-failed', 'close-failed', 'operation-failed'],
    phase: [
        'accepted',
        'running',
        'cancelling',
        'failed',
        'validating-official-server',
        'acquiring-data-directory',
        'creating-router',
        'launching',
        'waiting-cdp',
        'starting-official-server',
        'closing-resources',
        'requesting-normal-close',
        'awaiting-target-exit',
        'cancelling-created-target',
        'inspecting-permission',
        'awaiting-permission',
        'permission-handshake',
        'native-operation',
        'normal-close',
        'wait-exit',
        'wait-resources',
        'native-helper',
        'process-identity',
        'executable-identity',
        'rollback-request',
        'rollback-exit',
    ],
    category: [
        'authorization-cancelled',
        'access-denied',
        'native-monitor-failed',
        'native-operation-failed',
        'native-wait-failed',
        'helper-start-failed',
    ],
    code: [
        'EACCES',
        'EPERM',
        'ENOENT',
        'EEXIST',
        'ENOTDIR',
        'ENOTEMPTY',
        'EBUSY',
        'EIO',
        'EADDRINUSE',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'APP_CLOSING',
        'CONNECTION_BUSY',
        'CLIENT_CONTEXT_UNAVAILABLE',
        'ROOTS_UNAVAILABLE',
        'FORM_ELICITATION_UNAVAILABLE',
        'directory-invalid',
        'directory-missing',
        'directory-exists',
        'directory-not-directory',
        'directory-overlap',
        'directory-acquisition-failed',
        'directory-inspection-failed',
        'directory-identity-changed',
        'directory-cleanup-failed',
    ],
} as const;

export type AppSelectedOperation = AppOperationSummary & {
    result?: {
        connectionId?: string;
        sessionId?: string;
        status?: 'idle' | 'starting' | 'active' | 'lost' | 'closing' | 'close-failed';
        disposition?: 'Close' | 'Keep';
        upstreamStatus?: 'connected' | 'disconnected' | 'quarantined';
        processId?: number;
        port?: number;
        enabledToolCount?: number;
        pageIdsInvalidated?: boolean;
    };
    error?: {
        kind: (typeof APP_OPERATION_FAILURE_VALUES.kind)[number];
        phase?: (typeof APP_OPERATION_FAILURE_VALUES.phase)[number];
        category?: (typeof APP_OPERATION_FAILURE_VALUES.category)[number];
        code?: (typeof APP_OPERATION_FAILURE_VALUES.code)[number];
        nativeError?: number;
        closeRequested?: boolean;
        processExited?: boolean;
        closeConfirmed?: boolean;
        catalogUpstreamRetained?: boolean;
        listenerState?: 'owned' | 'foreign' | 'absent';
    };
    isolation?: DataIsolationEvidence;
    wait?: { cursor: number; complete: boolean; replayTruncated: boolean };
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
    selectedOperation?: AppSelectedOperation;
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

export function validateAppManagementFields(
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

function validateIsolation(isolation: unknown) {
    if (!isRecord(isolation)) throw new Error('Invalid isolation evidence.');
    if (isolation.mode === 'none') validateAppManagementFields(isolation, ['mode']);
    else {
        validateAppManagementFields(isolation, ['mode', 'path', 'cleanup', 'state'], ['nonempty']);
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

function validateOperation(item: unknown, details: readonly string[] = []) {
    validateAppManagementFields(
        item,
        ['operationId', 'requestId', 'state', 'phase', 'elapsedMs', 'cursor'],
        ['registrationId', 'connectionId', 'sessionId', 'action', ...details],
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
}

export function parseAppManagementSnapshot(value: unknown): AppManagementSnapshot {
    validateAppManagementFields(
        value,
        ['registrations', 'connections', 'operations', 'hosts'],
        ['selected', 'outcomes', 'selectedOperation'],
    );
    collection(value.registrations, (item) => {
        validateAppManagementFields(item, ['registrationId', 'resources', 'jobs']);
        identities(item, ['registrationId']);
        count(item.resources);
        count(item.jobs);
    });
    collection(value.connections, (item) => {
        validateAppManagementFields(
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
    collection(value.operations, (item) => validateOperation(item));
    if (value.selectedOperation !== undefined) {
        const operation = value.selectedOperation;
        validateOperation(operation, ['result', 'error', 'isolation', 'wait']);
        if (!isRecord(operation)) throw new Error('Invalid selected operation.');
        if (operation.result !== undefined) {
            const result = operation.result;
            validateAppManagementFields(
                result,
                [],
                [
                    'connectionId',
                    'sessionId',
                    'status',
                    'disposition',
                    'upstreamStatus',
                    'processId',
                    'port',
                    'enabledToolCount',
                    'pageIdsInvalidated',
                ],
            );
            identities(result, [], ['connectionId', 'sessionId']);
            if (
                result.status !== undefined &&
                !['idle', 'starting', 'active', 'lost', 'closing', 'close-failed'].includes(text(result.status))
            )
                throw new Error('Invalid operation result status.');
            if (result.disposition !== undefined && !['Close', 'Keep'].includes(text(result.disposition)))
                throw new Error('Invalid disposition.');
            if (
                result.upstreamStatus !== undefined &&
                !['connected', 'disconnected', 'quarantined'].includes(text(result.upstreamStatus))
            )
                throw new Error('Invalid upstream state.');
            for (const key of ['processId', 'port', 'enabledToolCount'])
                if (result[key] !== undefined) count(result[key]);
            if (result.pageIdsInvalidated !== undefined && typeof result.pageIdsInvalidated !== 'boolean')
                throw new Error('Invalid page identity evidence.');
        }
        if (operation.error !== undefined) {
            const error = operation.error;
            validateAppManagementFields(
                error,
                ['kind'],
                [
                    'phase',
                    'code',
                    'category',
                    'nativeError',
                    'closeRequested',
                    'processExited',
                    'closeConfirmed',
                    'catalogUpstreamRetained',
                    'listenerState',
                ],
            );
            for (const key of ['kind', 'phase', 'code', 'category'] as const)
                if (
                    (key === 'kind' || error[key] !== undefined) &&
                    !(APP_OPERATION_FAILURE_VALUES[key] as readonly string[]).includes(text(error[key]))
                )
                    throw new Error('Invalid bounded failure evidence.');
            if (error.nativeError !== undefined && !Number.isSafeInteger(error.nativeError))
                throw new Error('Invalid native error.');
            for (const key of ['closeRequested', 'processExited', 'closeConfirmed', 'catalogUpstreamRetained'])
                if (error[key] !== undefined && typeof error[key] !== 'boolean')
                    throw new Error('Invalid close evidence.');
            if (
                error.listenerState !== undefined &&
                !['owned', 'foreign', 'absent'].includes(text(error.listenerState))
            )
                throw new Error('Invalid listener evidence.');
        }
        if (operation.isolation !== undefined) validateIsolation(operation.isolation);
        if (operation.wait !== undefined) {
            validateAppManagementFields(operation.wait, ['cursor', 'complete', 'replayTruncated']);
            count(operation.wait.cursor);
            if (typeof operation.wait.complete !== 'boolean' || typeof operation.wait.replayTruncated !== 'boolean')
                throw new Error('Invalid operation wait evidence.');
        }
    }
    collection(value.hosts, (item) => {
        validateAppManagementFields(
            item,
            ['host', 'state', 'activation'],
            ['candidate', 'reason', 'version', 'installations'],
        );
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
                validateAppManagementFields(
                    installation,
                    ['version', 'scope', 'enabled', 'pathResolved'],
                    ['readOnlyReason'],
                );
                text(installation.version);
                text(installation.scope);
                if (typeof installation.enabled !== 'boolean' || typeof installation.pathResolved !== 'boolean')
                    throw new Error('Invalid installation state.');
                if (installation.readOnlyReason !== undefined) text(installation.readOnlyReason);
            });
    });
    if (value.selected !== undefined) {
        validateAppManagementFields(
            value.selected,
            ['connectionId', 'sessionId', 'enabledTools', 'mcpArgs'],
            ['launch', 'isolation'],
        );
        identities(value.selected, ['connectionId', 'sessionId']);
        collection(value.selected.enabledTools, text);
        collection(value.selected.mcpArgs, text);
        if (value.selected.launch !== undefined) {
            const launch = value.selected.launch;
            validateAppManagementFields(launch, ['executable', 'arguments', 'environmentNames'], ['cwd', 'portPolicy']);
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
        if (value.selected.isolation !== undefined) validateIsolation(value.selected.isolation);
    }
    if (value.outcomes !== undefined)
        collection(value.outcomes, (item) => {
            validateAppManagementFields(item, ['connectionId', 'state'], ['operationId', 'reason']);
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
    validateAppManagementFields(value, ['phase'], ['configuration', 'message', 'management', 'exitIntent']);
    if (value.phase !== 'starting' && value.phase !== 'ready' && value.phase !== 'closing' && value.phase !== 'failed')
        throw new Error('Invalid App management phase.');
    let configuration: AppConfigurationState | undefined;
    if (Object.hasOwn(value, 'configuration')) {
        validateAppManagementFields(value.configuration, ['desired', 'effective', 'restartRequired']);
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
