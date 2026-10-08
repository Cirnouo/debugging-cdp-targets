import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

/** Internal fixture contract; the only supported receiver catches inside its subscriber. */
export const FIXTURE_DIAGNOSTICS_CHANNEL = 'debugging-cdp-targets.fixture';
const observation = channel(FIXTURE_DIAGNOSTICS_CHANNEL);
const stages = [
    'operation',
    'operation-phase',
    'operation-route',
    'operation-error',
    'target-acquisition',
    'target-close',
    'target-exit-wait',
    'resource-disposal',
    'gateway-cleanup',
    'port-probe',
    'spawn',
    'readiness',
    'listener-ownership',
    'endpoint',
    'profile-check',
    'native-close',
    'native-command',
    'native-file',
    'native-snapshot',
    'data-directory-acquire',
    'data-directory-release',
    'data-directory-cleanup',
    'directory-lease',
] as const;
const outcomes = [
    'started',
    'succeeded',
    'failed',
    'cancelled',
    'retained',
    'released',
    'skipped',
    'observed',
    'rejected',
    'requested',
] as const;
const actions = ['start', 'restart', 'stop', 'end-task', 'status'] as const;
const phases = [
    'accepted',
    'running',
    'cancelling',
    'succeeded',
    'failed',
    'cancelled',
    'launching',
    'waiting-cdp',
    'validating-official-server',
    'acquiring-data-directory',
    'creating-router',
    'starting-official-server',
    'requesting-normal-close',
    'awaiting-target-exit',
    'closing-resources',
    'cancelling-created-target',
    'resource-cleanup',
    'normal-close',
    'process-identity',
    'executable-identity',
    'request-start',
    'headers',
    'body-start',
    'body-complete',
    'body-failed',
    'canonical',
    'inspect',
    'identity',
    'overlap',
    'remove',
    'create',
    'entries',
    'availability',
    'release-barrier',
    'attempt',
    'rollback-request',
    'rollback-exit',
] as const;
const reasons = [
    'process-exited',
    'process-monitor-lost',
    'official-disconnected',
    'close',
    'restart',
    'rollback',
    'disconnect',
    'retired',
    'cancelled',
    'acquired',
    'settled',
    'cleanup-failed',
    'target-rollback-failed',
    'missing-lock',
    'invalid-lock',
    'foreign-host',
    'live-lock-owner',
    'process-absent',
    'lock-access-failed',
    'process-probe-failed',
    'identity-missing',
    'identity-mismatch',
    'listener-owned',
    'listener-foreign',
    'listener-absent',
    'listener-non-loopback',
    'lock-accessible',
    'lock-refused',
    'profile-claimed',
    'availability-denied',
    'release-not-requested',
    'acquisition-pending',
    'successor-pending',
    'target-live',
    'resources-pending',
    'already-released',
    'release-pending',
] as const;
const commands = [
    'ps',
    'getconf',
    'lsof',
    'proc-stat',
    'proc-exe',
    'router',
    'upstream',
    'proc-boot',
    'executable-stat',
    'powershell',
    'netsh',
] as const;
const statuses = [
    'accepted',
    'running',
    'cancelling',
    'succeeded',
    'failed',
    'cancelled',
    'pending',
    'held',
    'retained',
    'released',
    'active',
    'idle',
    'lost',
    'starting',
    'closing',
    'close-failed',
    'healthy',
    'unavailable',
    'identity-changed',
    'gone',
    'owned',
    'foreign',
    'absent',
] as const;
const names = [
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'AggregateError',
    'AbortError',
    'TimeoutError',
    'AssertionError',
    'DOMException',
    'DetailedError',
    'RetainedTargetError',
    'UnknownError',
] as const;
const codes = [
    'EACCES',
    'EPERM',
    'ENOENT',
    'ESRCH',
    'EEXIST',
    'ENOTDIR',
    'EISDIR',
    'ENOTEMPTY',
    'EBUSY',
    'ELOOP',
    'EINVAL',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENOSPC',
    'EPIPE',
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'EADDRINUSE',
    'EADDRNOTAVAIL',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ABORT_ERR',
    'ERR_ABORTED',
    'ERR_INVALID_ARG_TYPE',
    'ERR_INVALID_ARG_VALUE',
    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    'RESOURCE_CLEANUP_FAILED',
    'PROCESS_OBSERVATION_UNAVAILABLE',
    'CONNECTION_RECOVERY_REQUIRED',
    'ERR_ASSERTION',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
    'directory-invalid',
    'directory-missing',
    'directory-exists',
    'directory-not-directory',
    'directory-overlap',
    'directory-acquisition-failed',
    'directory-inspection-failed',
    'directory-identity-changed',
    'directory-cleanup-failed',
] as const;
const syscalls = [
    'spawn',
    'connect',
    'listen',
    'kill',
    'stat',
    'lstat',
    'realpath',
    'readlink',
    'opendir',
    'readdir',
    'open',
    'mkdir',
    'unlink',
    'rmdir',
    'write',
    'read',
    'close',
    'access',
    'socket',
    'bind',
    'scandir',
] as const;

export type FixtureStage = (typeof stages)[number];
export type FixtureOutcome = (typeof outcomes)[number];
export interface FixtureIdentity {
    entryId?: string | undefined;
    operationId?: string | undefined;
    originOperationId?: string | undefined;
    requestId?: string | undefined;
    action?: (typeof actions)[number] | undefined;
    connectionId?: string | undefined;
    sessionId?: string | undefined;
    pid?: number | undefined;
    port?: number | undefined;
    trigger?: 'gateway-disconnect' | undefined;
}
export interface FixtureFields extends FixtureIdentity {
    outcome?: FixtureOutcome;
    durationMs?: number | undefined;
    elapsedMs?: number;
    attempt?: number | undefined;
    count?: number | undefined;
    pendingCount?: number | undefined;
    resourceCount?: number | undefined;
    budgetMs?: number | undefined;
    remainingMs?: number | undefined;
    exitCode?: number | null;
    httpStatus?: number;
    nativeError?: number;
    stderrPresent?: boolean;
    valid?: boolean;
    available?: boolean;
    reason?: (typeof reasons)[number];
    command?: (typeof commands)[number];
    status?: (typeof statuses)[number];
    phase?: (typeof phases)[number];
}
export interface FixtureError {
    readonly name: (typeof names)[number];
    readonly code?: (typeof codes)[number];
    readonly syscall?: (typeof syscalls)[number];
    readonly errno?: number | undefined;
    readonly cause?: FixtureError;
    readonly truncated?: true;
}
export interface FixtureEvent extends Readonly<FixtureFields> {
    readonly stage: FixtureStage;
    readonly event: 'begin' | 'end' | 'decision';
    readonly outcome: FixtureOutcome;
    readonly timestampMs: number;
    readonly durationMs: number;
    readonly error?: FixtureError;
}
export type FixtureOrigin = Readonly<FixtureIdentity>;
type Scope = FixtureIdentity | (() => FixtureIdentity);
const scopes = new AsyncLocalStorage<Scope>();
const identityKeys = [
    'entryId',
    'operationId',
    'originOperationId',
    'requestId',
    'action',
    'connectionId',
    'sessionId',
    'pid',
    'port',
    'trigger',
] as const;
const fieldKeys = [
    ...identityKeys,
    'outcome',
    'durationMs',
    'elapsedMs',
    'attempt',
    'count',
    'pendingCount',
    'resourceCount',
    'budgetMs',
    'remainingMs',
    'exitCode',
    'httpStatus',
    'nativeError',
    'stderrPresent',
    'valid',
    'available',
    'reason',
    'command',
    'status',
    'phase',
] as const;
const eventKeys = [...fieldKeys, 'stage', 'event', 'timestampMs', 'error'];

function member<T extends string>(values: readonly T[], value: unknown): value is T {
    return typeof value === 'string' && values.some((selected) => selected === value);
}
function plain(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
}
function detachedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
    if (!plain(value)) return;
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !keys.includes(key)) return;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return;
        result[key] = descriptor.value;
    }
    return result;
}
function safeField(key: string, value: unknown): boolean {
    if (['entryId', 'operationId', 'originOperationId', 'requestId', 'connectionId', 'sessionId'].includes(key))
        return (
            typeof value === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
        );
    if (key === 'action') return member(actions, value);
    if (key === 'outcome') return member(outcomes, value);
    if (key === 'reason') return member(reasons, value);
    if (key === 'command') return member(commands, value);
    if (key === 'status') return member(statuses, value);
    if (key === 'phase') return member(phases, value);
    if (key === 'trigger') return value === 'gateway-disconnect';
    if (['stderrPresent', 'valid', 'available'].includes(key)) return typeof value === 'boolean';
    if (key === 'exitCode') return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    if (['durationMs', 'timestampMs', 'elapsedMs', 'budgetMs', 'remainingMs'].includes(key)) return true;
    if (!Number.isSafeInteger(value)) return false;
    if (key === 'pid') return value > 0;
    if (key === 'port') return value > 0 && value <= 65535;
    if (key === 'httpStatus') return value >= 100 && value <= 599;
    return ['attempt', 'count', 'pendingCount', 'resourceCount', 'nativeError'].includes(key);
}
function copyFields(value: FixtureFields): FixtureFields {
    const result: Record<string, unknown> = {};
    for (const key of fieldKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor && safeField(key, descriptor.value)) result[key] = descriptor.value;
    }
    return result;
}
function current(): FixtureIdentity {
    const scope = scopes.getStore();
    return scope ? copyFields(typeof scope === 'function' ? scope() : scope) : {};
}

function errorMetadata(value: unknown, seen = new Set<unknown>(), depth = 0): FixtureError {
    const result: {
        name: FixtureError['name'];
        code?: (typeof codes)[number];
        syscall?: (typeof syscalls)[number];
        errno?: number | undefined;
        cause?: FixtureError;
        truncated?: true;
    } = { name: 'UnknownError' };
    if (!value || typeof value !== 'object') return Object.freeze(result);
    if (seen.has(value) || depth >= 4) return Object.freeze({ name: 'UnknownError', truncated: true });
    seen.add(value);
    try {
        const name: unknown = Reflect.get(value, 'name');
        const code: unknown = Reflect.get(value, 'code');
        const syscall: unknown = Reflect.get(value, 'syscall');
        const errno: unknown = Reflect.get(value, 'errno');
        const cause: unknown = Reflect.get(value, 'cause');
        if (member(names, name)) result.name = name;
        if (member(codes, code)) result.code = code;
        if (member(syscalls, syscall)) result.syscall = syscall;
        if (typeof errno === 'number' && Number.isSafeInteger(errno)) result.errno = errno;
        if (cause !== undefined) result.cause = errorMetadata(cause, seen, depth + 1);
    } catch {
        // Accessors/proxies are untrusted error data; never inspect message or stack.
    }
    return Object.freeze(result);
}
export function serializeFixtureError(value: unknown): FixtureError {
    return errorMetadata(value);
}
function detachedError(value: unknown, depth = 0): FixtureError | undefined {
    if (depth > 4) return;
    const selected = detachedRecord(value, ['name', 'code', 'syscall', 'errno', 'cause', 'truncated']);
    if (!selected) return;
    const { name, code, syscall, errno, cause, truncated } = selected;
    if (
        !member(names, name) ||
        (code !== undefined && !member(codes, code)) ||
        (syscall !== undefined && !member(syscalls, syscall)) ||
        (errno !== undefined && (typeof errno !== 'number' || !Number.isSafeInteger(errno))) ||
        (truncated !== undefined && truncated !== true)
    )
        return;
    const copiedCause = cause === undefined ? undefined : detachedError(cause, depth + 1);
    if (cause !== undefined && copiedCause === undefined) return;
    return Object.freeze({
        name,
        ...(code === undefined ? {} : { code }),
        ...(syscall === undefined ? {} : { syscall }),
        ...(errno === undefined ? {} : { errno }),
        ...(copiedCause === undefined ? {} : { cause: copiedCause }),
        ...(truncated === undefined ? {} : { truncated }),
    });
}
/** Independently validates unknown channel data and freezes a detached copy. */
export function validateFixtureEvent(value: unknown): FixtureEvent | undefined {
    try {
        const selected = detachedRecord(value, eventKeys);
        if (
            !selected ||
            !member(stages, selected.stage) ||
            !member(['begin', 'end', 'decision'], selected.event) ||
            !member(outcomes, selected.outcome) ||
            typeof selected.timestampMs !== 'number' ||
            typeof selected.durationMs !== 'number' ||
            !safeField('timestampMs', selected.timestampMs) ||
            !safeField('durationMs', selected.durationMs)
        )
            return;
        for (const key of fieldKeys) if (key in selected && !safeField(key, selected[key])) return;
        const error = 'error' in selected ? detachedError(selected.error) : undefined;
        if ('error' in selected && !error) return;
        return Object.freeze({
            ...copyFields(selected),
            stage: selected.stage,
            event: selected.event,
            outcome: selected.outcome,
            timestampMs: selected.timestampMs,
            durationMs: selected.durationMs,
            ...(error ? { error } : {}),
        });
    } catch {
        return;
    }
}
export function fixtureHasSubscribers(): boolean {
    return observation.hasSubscribers;
}
export function emitFixturePhase(phase: unknown): void {
    if (!observation.hasSubscribers || !member(phases, phase)) return;
    emitFixtureEvent('operation-phase', 'decision', { phase });
}
export function runFixtureObservation<T>(identity: Scope, job: () => T): T {
    if (!observation.hasSubscribers) return job();
    return scopes.run(identity, job);
}
/** Snapshot direct I/O identity without retaining a mutable route resolver. */
export function captureFixtureOrigin(overrides: FixtureIdentity = {}): FixtureOrigin | undefined {
    if (!observation.hasSubscribers) return;
    try {
        const selected = { ...current(), ...overrides };
        const { operationId, requestId: _requestId, action: _action, trigger: _trigger, ...identity } = selected;
        return Object.freeze(copyFields({ ...identity, ...(operationId ? { originOperationId: operationId } : {}) }));
    } catch {
        return;
    }
}
/** Pin direct I/O identity while retaining the current operation scope. */
export function runFixtureResource<T>(origin: FixtureOrigin | undefined, job: () => T): T {
    if (!observation.hasSubscribers || !origin) return job();
    let identity: FixtureIdentity;
    try {
        const { operationId, requestId, action, trigger } = current();
        identity = { ...origin, operationId, requestId, action, trigger };
    } catch {
        return job();
    }
    return scopes.run(identity, job);
}
export function runFixtureCleanup<T>(identity: Pick<FixtureIdentity, 'entryId'>, job: () => T): T {
    if (!observation.hasSubscribers) return job();
    let selected: FixtureIdentity;
    try {
        selected = copyFields(identity);
    } catch {
        selected = {};
    }
    return scopes.run({ ...selected, trigger: 'gateway-disconnect' }, job);
}
export function emitFixtureEvent(
    stage: FixtureStage,
    event: FixtureEvent['event'],
    fields: FixtureFields = {},
    error?: unknown,
): void {
    if (!observation.hasSubscribers) return;
    let payload: FixtureEvent;
    try {
        if (!member(stages, stage) || !member(['begin', 'end', 'decision'], event)) return;
        const metadata = copyFields({ ...current(), ...fields });
        payload = Object.freeze({
            ...metadata,
            stage,
            event,
            outcome: metadata.outcome ?? (event === 'begin' ? 'started' : event === 'end' ? 'succeeded' : 'observed'),
            timestampMs: performance.now(),
            durationMs: metadata.durationMs ?? 0,
            ...(error === undefined ? {} : { error: errorMetadata(error) }),
        });
    } catch {
        return;
    }
    // Arbitrary diagnostics_channel subscribers are not isolated by a publisher try/catch.
    // Only subscribeFixtureDiagnostics is supported; its catch runs INSIDE its callback.
    observation.publish(payload);
}
type Finish = (outcome: FixtureOutcome, fields?: FixtureFields, error?: unknown) => void;
const unobservedFinish: Finish = () => {};
export function beginFixtureStage(stage: FixtureStage, fields: FixtureFields = {}): Finish {
    if (!observation.hasSubscribers) return unobservedFinish;
    let metadata: Readonly<FixtureFields>;
    try {
        metadata = Object.freeze(copyFields(fields));
    } catch {
        return unobservedFinish;
    }
    const started = performance.now();
    emitFixtureEvent(stage, 'begin', metadata);
    return (outcome, result = {}, error) => {
        if (!observation.hasSubscribers) return;
        let copied: FixtureFields;
        try {
            copied = copyFields(result);
        } catch {
            return;
        }
        emitFixtureEvent(
            stage,
            'end',
            { ...metadata, ...copied, outcome, durationMs: Math.max(0, performance.now() - started) },
            error,
        );
    };
}
export function subscribeFixtureDiagnostics(
    callback: (event: FixtureEvent) => void,
    onRejected?: () => void,
): () => void {
    const receive = (data: unknown) => {
        try {
            const event = validateFixtureEvent(data);
            const returned: unknown = event ? callback(event) : onRejected?.();
            if (returned !== undefined) void Promise.resolve(returned).catch(() => {});
        } catch {
            // Node treats subscriber throws as fatal; containment belongs inside this callback.
        }
    };
    observation.subscribe(receive);
    return () => observation.unsubscribe(receive);
}
