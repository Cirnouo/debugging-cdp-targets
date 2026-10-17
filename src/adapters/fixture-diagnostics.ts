import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

/** Internal fixture contract; the only supported receiver catches inside its subscriber. */
export const FIXTURE_DIAGNOSTICS_CHANNEL = 'debugging-cdp-targets.fixture';
const observation = channel(FIXTURE_DIAGNOSTICS_CHANNEL);
const creationRegistryObservation = channel('debugging-cdp-targets.fixture.creation-observation-registry');
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
    'listener-owner-evidence',
    'endpoint',
    'profile-check',
    'native-close',
    'native-command',
    'native-file',
    'native-snapshot',
    'process-creation-identity',
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
const rootProcessStates = [
    'running',
    'sleeping',
    'disk-sleep',
    'stopped',
    'tracing-stop',
    'dead',
    'zombie',
    'parked',
    'idle',
    'unknown',
] as const;
const readinessExitReasons = [
    'budget-exhausted',
    'foreign-listener',
    'terminal-condition',
    'poll-interrupted',
] as const;
const listenerOwnerRelations = [
    'root',
    'owned-descendant',
    'owner-row-missing',
    'ancestor-row-missing',
    'uid-mismatch',
    'child-before-parent',
    'unrelated-root',
    'cycle',
    'depth-limit',
    'invalid-owner',
    'root-absent',
] as const;
const signals = [
    'SIGABRT',
    'SIGALRM',
    'SIGBUS',
    'SIGCHLD',
    'SIGCONT',
    'SIGFPE',
    'SIGHUP',
    'SIGILL',
    'SIGINT',
    'SIGIO',
    'SIGIOT',
    'SIGKILL',
    'SIGPIPE',
    'SIGPOLL',
    'SIGPROF',
    'SIGPWR',
    'SIGQUIT',
    'SIGSEGV',
    'SIGSTKFLT',
    'SIGSTOP',
    'SIGSYS',
    'SIGTERM',
    'SIGTRAP',
    'SIGTSTP',
    'SIGTTIN',
    'SIGTTOU',
    'SIGUNUSED',
    'SIGURG',
    'SIGUSR1',
    'SIGUSR2',
    'SIGVTALRM',
    'SIGWINCH',
    'SIGXCPU',
    'SIGXFSZ',
    'SIGBREAK',
    'SIGLOST',
    'SIGINFO',
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
export interface CreationIdentityFields {
    creationNewlyLaunched?: boolean;
    creationBranch?:
        | 'new-lower-rejected'
        | 'new-upper-rejected'
        | 'new-accepted'
        | 'established-delta-rejected'
        | 'established-accepted'
        | 'creation-unverifiable';
    creationToleranceMs?: number;
    creationExpectedUtcMs?: number;
    creationObservedUtcMs?: number;
    creationUpperNowUtcMs?: number;
    creationUpperNowStatus?: 'read' | 'not-evaluated';
    creationBootSeconds?: number;
    creationStartTicks?: number;
    creationClkTck?: number;
    creationComputedNumberMs?: number;
    creationStatReadStartedMs?: number;
    creationStatReadEndedMs?: number;
    creationBootReadStartedMs?: number;
    creationBootReadEndedMs?: number;
    creationClkReadStartedMs?: number;
    creationClkReadEndedMs?: number;
    creationSourceStatus?: 'complete' | 'missing' | 'unverifiable';
    creationComparisonStatus?: 'reached' | 'unverifiable' | 'not-reached';
}
const creationSourceKeys = [
    'creationBootSeconds',
    'creationStartTicks',
    'creationClkTck',
    'creationComputedNumberMs',
    'creationStatReadStartedMs',
    'creationStatReadEndedMs',
    'creationBootReadStartedMs',
    'creationBootReadEndedMs',
    'creationClkReadStartedMs',
    'creationClkReadEndedMs',
] as const;
const creationKeys = [
    ...creationSourceKeys,
    'creationNewlyLaunched',
    'creationBranch',
    'creationToleranceMs',
    'creationExpectedUtcMs',
    'creationObservedUtcMs',
    'creationUpperNowUtcMs',
    'creationUpperNowStatus',
    'creationSourceStatus',
    'creationComparisonStatus',
] as const;
function utc(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000;
}
function safeCreationField(key: string, value: unknown): boolean {
    if (key === 'creationNewlyLaunched') return typeof value === 'boolean';
    if (key === 'creationToleranceMs') return value === 1_000;
    if (key === 'creationBranch')
        return member(
            [
                'new-lower-rejected',
                'new-upper-rejected',
                'new-accepted',
                'established-delta-rejected',
                'established-accepted',
                'creation-unverifiable',
            ],
            value,
        );
    if (key === 'creationUpperNowStatus') return member(['read', 'not-evaluated'], value);
    if (key === 'creationSourceStatus') return member(['complete', 'missing', 'unverifiable'], value);
    if (key === 'creationComparisonStatus') return member(['reached', 'unverifiable', 'not-reached'], value);
    if (['creationExpectedUtcMs', 'creationObservedUtcMs', 'creationUpperNowUtcMs'].includes(key)) return utc(value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (key === 'creationComputedNumberMs') return Math.abs(value) <= 8_640_000_000_000_000;
    if (key.endsWith('Ms')) return value >= 0;
    return Number.isSafeInteger(value) && value >= (key === 'creationClkTck' ? 1 : 0);
}
function validCreation(selected: Record<string, unknown>): boolean {
    if (selected.stage !== 'process-creation-identity')
        return !('linuxIdentity' in selected) && creationKeys.every((key) => !(key in selected));
    if ('linuxIdentity' in selected) {
        const value = validateLinuxIdentity(selected.linuxIdentity);
        return (
            !!value &&
            selected.event === 'decision' &&
            selected.phase === 'process-identity' &&
            selected.outcome === (linuxIdentityAccepted(value) ? 'observed' : 'rejected') &&
            Object.keys(selected).every((key) =>
                [
                    ...identityKeys,
                    'linuxIdentity',
                    'stage',
                    'event',
                    'phase',
                    'outcome',
                    'timestampMs',
                    'durationMs',
                ].includes(key),
            )
        );
    }
    const allowed = [
        ...identityKeys,
        ...creationKeys,
        'stage',
        'event',
        'phase',
        'outcome',
        'timestampMs',
        'durationMs',
    ];
    if (Object.keys(selected).some((key) => !allowed.includes(key))) return false;
    if (
        selected.event !== 'decision' ||
        selected.phase !== 'process-identity' ||
        !member(['observed', 'rejected'], selected.outcome) ||
        selected.error !== undefined ||
        typeof selected.creationNewlyLaunched !== 'boolean' ||
        selected.creationToleranceMs !== 1_000 ||
        !member(['complete', 'missing', 'unverifiable'], selected.creationSourceStatus) ||
        !member(['reached', 'unverifiable', 'not-reached'], selected.creationComparisonStatus) ||
        !member(['read', 'not-evaluated'], selected.creationUpperNowStatus)
    )
        return false;
    if (selected.creationSourceStatus === 'complete') {
        if (!creationSourceKeys.every((key) => key in selected)) return false;
        for (const prefix of ['Stat', 'Boot', 'Clk']) {
            const start = selected[`creation${prefix}ReadStartedMs`];
            const end = selected[`creation${prefix}ReadEndedMs`];
            if (typeof start !== 'number' || typeof end !== 'number' || end < start) return false;
        }
        if (
            selected.creationComputedNumberMs !==
            Number(selected.creationBootSeconds) * 1_000 +
                (Number(selected.creationStartTicks) / Number(selected.creationClkTck)) * 1_000
        )
            return false;
        if (
            selected.creationObservedUtcMs !== undefined &&
            Math.trunc(Number(selected.creationComputedNumberMs)) !== selected.creationObservedUtcMs
        )
            return false;
    } else if (creationSourceKeys.some((key) => key in selected)) return false;
    const branch = selected.creationBranch;
    const status = selected.creationComparisonStatus;
    if (
        (status !== 'reached' ||
            member(['new-lower-rejected', 'new-upper-rejected', 'established-delta-rejected'], branch)) &&
        selected.outcome !== 'rejected'
    )
        return false;
    if (status === 'not-reached') {
        if (
            branch !== undefined ||
            selected.creationExpectedUtcMs !== undefined ||
            selected.creationObservedUtcMs !== undefined
        )
            return false;
    } else if (status === 'unverifiable') {
        if (
            branch !== 'creation-unverifiable' ||
            selected.creationExpectedUtcMs !== undefined ||
            selected.creationObservedUtcMs !== undefined
        )
            return false;
    } else {
        if (
            !utc(selected.creationExpectedUtcMs) ||
            !utc(selected.creationObservedUtcMs) ||
            branch === 'creation-unverifiable'
        )
            return false;
        if (
            selected.creationNewlyLaunched
                ? !member(['new-lower-rejected', 'new-upper-rejected', 'new-accepted'], branch)
                : !member(['established-delta-rejected', 'established-accepted'], branch)
        )
            return false;
    }
    if (
        status === 'reached' &&
        typeof selected.creationObservedUtcMs === 'number' &&
        typeof selected.creationExpectedUtcMs === 'number'
    ) {
        const actual = selected.creationObservedUtcMs;
        const expected = selected.creationExpectedUtcMs;
        if (
            branch === 'new-lower-rejected'
                ? !(actual < expected - 1_000)
                : selected.creationNewlyLaunched && actual < expected - 1_000
        )
            return false;
        if (branch === 'established-delta-rejected' && !(Math.abs(actual - expected) > 1_000)) return false;
        if (branch === 'established-accepted' && Math.abs(actual - expected) > 1_000) return false;
        if (branch === 'new-upper-rejected' && !(actual > Number(selected.creationUpperNowUtcMs) + 1_000)) return false;
        if (branch === 'new-accepted' && actual > Number(selected.creationUpperNowUtcMs) + 1_000) return false;
    }
    const upper = branch === 'new-upper-rejected' || branch === 'new-accepted';
    return upper
        ? selected.creationUpperNowStatus === 'read' && utc(selected.creationUpperNowUtcMs)
        : selected.creationUpperNowStatus === 'not-evaluated' && selected.creationUpperNowUtcMs === undefined;
}

/** Closed numeric group shared by the internal event and fixture receipt decoder. */
export const CREATION_IDENTITY_FIELD_KEYS = creationKeys;
export function validateCreationIdentityFields(value: unknown): Readonly<CreationIdentityFields> | undefined {
    try {
        const selected = detachedRecord(value, creationKeys);
        if (!selected || Object.entries(selected).some(([key, field]) => !safeCreationField(key, field))) return;
        if (
            !validCreation({
                ...selected,
                stage: 'process-creation-identity',
                event: 'decision',
                phase: 'process-identity',
                outcome: 'rejected',
                timestampMs: 0,
                durationMs: 0,
            })
        )
            return;
        return Object.freeze(selected);
    } catch {
        return;
    }
}

export type LinuxDiagnosticInterval = Readonly<{ lowerNs: string; upperNs: string }>;
export type LinuxDiagnosticCalibration = Readonly<{
    beforeUtcMs: number;
    afterUtcMs: number;
    uptimeUpperNs: string;
    offset: LinuxDiagnosticInterval;
}>;
export const linuxIdentityDecisions = [
    'no-launch',
    'launch-check-threw',
    'root-proof-rejected',
    'established-changed',
    'established-accepted',
    'boot-missing',
    'post-calibration-threw',
    'post-launch-check-threw',
    'clock-order-rejected',
    'root-proof-changed',
    'decision-clock-rejected',
    'interval-rejected',
    'readiness-check-threw',
    'final-launch-check-threw',
    'concurrent-changed',
    'initial-accepted',
] as const;
export interface LinuxIdentityFacts {
    pre?: LinuxDiagnosticCalibration;
    post?: LinuxDiagnosticCalibration;
    postFailure?: Readonly<{ branch: 'read-or-abort' | 'bracket-or-text-invalid' | 'uptime-out-of-range' }>;
    raw?: Readonly<{ q: string; H: string; bootSeconds?: string }>;
    requestUtcMs?: number;
    decisionUtcMs?: number;
    offset?: LinuxDiagnosticInterval & Readonly<{ status: 'nonempty' | 'empty' }>;
    birth?: Readonly<{
        branch: 'divide' | 'multiply-512' | 'multiply-9' | 'input-rejected';
        result: 'present' | 'input-rejected' | 'zero-divisor' | 'range-rejected' | 'empty';
        readerUpperNs: string;
        interval?: LinuxDiagnosticInterval;
    }>;
    absolute?: LinuxDiagnosticInterval;
    public?: Readonly<{
        branch:
            | 'invalid-clock'
            | 'containment-or-order-rejected'
            | 'point-or-date-range-rejected'
            | 'date-roundtrip-rejected'
            | 'accepted';
        pointMs?: string;
    }>;
    selectedMs?: number;
}
export interface LinuxPrivateIntervalV1 {
    readonly model: 'linux-private-interval-v1';
    readonly mode: 'unregistered' | 'unselected' | 'initial' | 'established';
    readonly decision: (typeof linuxIdentityDecisions)[number];
    readonly timeBasis: 'source-stat-read-ended';
    readonly facts: Readonly<LinuxIdentityFacts>;
}
export type CreationIdentity =
    | Readonly<CreationIdentityFields>
    | (LinuxPrivateIntervalV1 & { readonly [K in keyof CreationIdentityFields]?: never });
const linuxFactKeys = [
    'pre',
    'post',
    'postFailure',
    'raw',
    'requestUtcMs',
    'decisionUtcMs',
    'offset',
    'birth',
    'absolute',
    'public',
    'selectedMs',
];
function decimal(value: unknown, kind: 'N' | 'U' | 'S' = 'N'): value is string {
    if (typeof value !== 'string' || value.length > 26 || !/^(?:0|-?[1-9][0-9]{0,24})$/.test(value)) return false;
    if (kind === 'N') return true;
    if (value.startsWith('-') || value.length > 20) return false;
    return BigInt(value) <= (kind === 'U' ? 18446744073709551615n : 9007199254740991n);
}
function safeMs(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}
function diagnosticInterval(value: unknown, unsigned = false): LinuxDiagnosticInterval | undefined {
    const v = detachedRecord(value, ['lowerNs', 'upperNs']);
    if (
        !v ||
        !decimal(v.lowerNs, unsigned ? 'U' : 'N') ||
        !decimal(v.upperNs, unsigned ? 'U' : 'N') ||
        BigInt(v.lowerNs) > BigInt(v.upperNs)
    )
        return;
    return Object.freeze({ lowerNs: v.lowerNs, upperNs: v.upperNs });
}
function diagnosticCalibration(value: unknown): LinuxDiagnosticCalibration | undefined {
    const v = detachedRecord(value, ['beforeUtcMs', 'afterUtcMs', 'uptimeUpperNs', 'offset']);
    if (
        !v ||
        !safeMs(v.beforeUtcMs) ||
        !safeMs(v.afterUtcMs) ||
        v.beforeUtcMs < 0 ||
        v.afterUtcMs < v.beforeUtcMs ||
        !decimal(v.uptimeUpperNs, 'U')
    )
        return;
    const offset = diagnosticInterval(v.offset);
    if (!offset) return;
    return Object.freeze({
        beforeUtcMs: v.beforeUtcMs,
        afterUtcMs: v.afterUtcMs,
        uptimeUpperNs: v.uptimeUpperNs,
        offset,
    });
}
/** Closed reached facts, never a rerun of identity authorization. */
export function validateLinuxIdentity(value: unknown): LinuxPrivateIntervalV1 | undefined {
    try {
        const v = detachedRecord(value, ['model', 'mode', 'decision', 'timeBasis', 'facts']);
        if (
            v?.model !== 'linux-private-interval-v1' ||
            v.timeBasis !== 'source-stat-read-ended' ||
            !member(['unregistered', 'unselected', 'initial', 'established'], v.mode) ||
            !member(linuxIdentityDecisions, v.decision)
        )
            return;
        const f = detachedRecord(v.facts, linuxFactKeys);
        if (!f) return;
        const facts: LinuxIdentityFacts = {};
        for (const key of ['pre', 'post'] as const)
            if (key in f) {
                const item = diagnosticCalibration(f[key]);
                if (!item) return;
                facts[key] = item;
            }
        if ('raw' in f) {
            const r = detachedRecord(f.raw, ['q', 'H', 'bootSeconds']);
            if (
                !r ||
                !decimal(r.q, 'S') ||
                !decimal(r.H, 'S') ||
                r.H === '0' ||
                ('bootSeconds' in r && !decimal(r.bootSeconds, 'S'))
            )
                return;
            facts.raw = Object.freeze({
                q: r.q,
                H: r.H,
                ...(typeof r.bootSeconds === 'string' ? { bootSeconds: r.bootSeconds } : {}),
            });
        }
        for (const key of ['requestUtcMs', 'decisionUtcMs', 'selectedMs'] as const)
            if (key in f) {
                const item = f[key];
                if (!safeMs(item) || (key === 'selectedMs' && !utc(item))) return;
                facts[key] = item;
            }
        if ('postFailure' in f) {
            const r = detachedRecord(f.postFailure, ['branch']);
            if (!r || !member(['read-or-abort', 'bracket-or-text-invalid', 'uptime-out-of-range'], r.branch)) return;
            facts.postFailure = Object.freeze({ branch: r.branch });
        }
        if ('offset' in f) {
            const r = detachedRecord(f.offset, ['status', 'lowerNs', 'upperNs']);
            if (
                !r ||
                !member(['empty', 'nonempty'], r.status) ||
                !decimal(r.lowerNs) ||
                !decimal(r.upperNs) ||
                BigInt(r.lowerNs) <= BigInt(r.upperNs) !== (r.status === 'nonempty')
            )
                return;
            facts.offset = Object.freeze({ status: r.status, lowerNs: r.lowerNs, upperNs: r.upperNs });
        }
        if ('birth' in f) {
            const r = detachedRecord(f.birth, ['branch', 'result', 'readerUpperNs', 'interval']);
            if (
                !r ||
                !member(['divide', 'multiply-512', 'multiply-9', 'input-rejected'], r.branch) ||
                !member(['present', 'input-rejected', 'zero-divisor', 'range-rejected', 'empty'], r.result) ||
                !decimal(r.readerUpperNs, 'U')
            )
                return;
            const interval = 'interval' in r ? diagnosticInterval(r.interval, true) : undefined;
            if (
                (r.result === 'present') !== 'interval' in r ||
                ('interval' in r && !interval) ||
                (r.branch === 'input-rejected') !== (r.result === 'input-rejected') ||
                (r.result === 'zero-divisor' && r.branch !== 'multiply-9') ||
                (r.result === 'range-rejected' && !member(['multiply-512', 'multiply-9'], r.branch))
            )
                return;
            facts.birth = Object.freeze({
                branch: r.branch,
                result: r.result,
                readerUpperNs: r.readerUpperNs,
                ...(interval ? { interval } : {}),
            });
        }
        if ('absolute' in f) {
            const r = diagnosticInterval(f.absolute);
            if (!r) return;
            facts.absolute = r;
        }
        if ('public' in f) {
            const r = detachedRecord(f.public, ['branch', 'pointMs']);
            if (
                !r ||
                !member(
                    [
                        'invalid-clock',
                        'containment-or-order-rejected',
                        'point-or-date-range-rejected',
                        'date-roundtrip-rejected',
                        'accepted',
                    ],
                    r.branch,
                )
            )
                return;
            const pointReached = member(
                ['point-or-date-range-rejected', 'date-roundtrip-rejected', 'accepted'],
                r.branch,
            );
            if (pointReached !== 'pointMs' in r || ('pointMs' in r && !decimal(r.pointMs))) return;
            if (
                member(['accepted', 'date-roundtrip-rejected'], r.branch) &&
                typeof r.pointMs === 'string' &&
                (BigInt(r.pointMs) < -8640000000000000n || BigInt(r.pointMs) > 8640000000000000n)
            )
                return;
            facts.public = Object.freeze({
                branch: r.branch,
                ...(typeof r.pointMs === 'string' ? { pointMs: r.pointMs } : {}),
            });
        }
        const d = v.decision;
        let required: string[] = [];
        let allowed: string[] = [];
        if (d === 'no-launch') {
            if (v.mode !== 'unregistered') return;
        } else if (member(['launch-check-threw', 'root-proof-rejected'], d)) {
            if (v.mode !== 'unselected') return;
        } else if (member(['established-changed', 'established-accepted'], d)) {
            if (v.mode !== 'established') return;
            required = d === 'established-accepted' ? ['raw', 'selectedMs'] : ['raw'];
            allowed = required;
        } else {
            if (v.mode !== 'initial') return;
            required = ['raw', 'pre', 'requestUtcMs'];
            allowed = [...required];
            if (d === 'boot-missing') {
                if (facts.raw?.bootSeconds !== undefined) return;
            } else {
                if (facts.raw?.bootSeconds === undefined) return;
                if (d === 'post-calibration-threw') {
                    required.push('postFailure');
                    allowed.push('postFailure');
                } else {
                    required.push('post');
                    allowed.push('post');
                    if (!member(['post-launch-check-threw', 'clock-order-rejected', 'root-proof-changed'], d)) {
                        required.push('offset', 'birth');
                        allowed.push('offset', 'birth', 'decisionUtcMs');
                        if (d !== 'decision-clock-rejected') {
                            const entered = facts.offset?.status === 'nonempty' && facts.birth?.result === 'present';
                            if (entered) {
                                required.push('absolute', 'public');
                                allowed.push('absolute', 'public');
                            }
                            if (d !== 'interval-rejected') {
                                if (!entered || facts.public?.branch !== 'accepted') return;
                                required.push('decisionUtcMs');
                                if (d === 'initial-accepted') {
                                    required.push('selectedMs');
                                    allowed.push('selectedMs');
                                }
                            } else if (facts.public?.branch === 'accepted') return;
                        }
                    }
                }
            }
        }
        if (required.some((key) => !(key in f)) || Object.keys(f).some((key) => !allowed.includes(key))) return;
        const result: LinuxPrivateIntervalV1 = Object.freeze({
            model: v.model,
            mode: v.mode,
            decision: d,
            timeBasis: v.timeBasis,
            facts: Object.freeze(facts),
        });
        if (Buffer.byteLength(JSON.stringify(result)) > 3000) return;
        return result;
    } catch {
        return;
    }
}
export function linuxIdentityAccepted(value: LinuxPrivateIntervalV1): boolean {
    return value.decision === 'initial-accepted' || value.decision === 'established-accepted';
}
export function validateCreationIdentity(value: unknown): CreationIdentity | undefined {
    const current = validateLinuxIdentity(value);
    return current ?? validateCreationIdentityFields(value);
}

export interface FixtureFields extends FixtureIdentity, CreationIdentityFields {
    linuxIdentity?: LinuxPrivateIntervalV1;
    outcome?: FixtureOutcome;
    durationMs?: number | undefined;
    elapsedMs?: number;
    attempt?: number | undefined;
    count?: number | undefined;
    ownedDescendantCount?: number;
    listenerOwnerCount?: number;
    listenerRecordCount?: number;
    listenerOwnerEmittedCount?: number;
    listenerOwnerOmittedCount?: number;
    listenerOwnerRecordCount?: number;
    listenerOwnerPid?: number;
    listenerOwnerParentPid?: number;
    listenerOwnerUid?: number;
    listenerOwnerStartedAtMs?: number;
    rootOwnerUid?: number;
    rootOwnerStartedAtMs?: number;
    listenerOwnerRelation?: (typeof listenerOwnerRelations)[number];
    listenerOwnerOwned?: boolean;
    pendingCount?: number | undefined;
    resourceCount?: number | undefined;
    budgetMs?: number | undefined;
    remainingMs?: number | undefined;
    exitCode?: number | null;
    signalCode?: string | null;
    exitObserved?: boolean;
    monitoringFailed?: boolean;
    readinessExitReason?: (typeof readinessExitReasons)[number];
    rootProcessState?: (typeof rootProcessStates)[number];
    rootStartTicks?: number;
    rootUserTicks?: number;
    rootSystemTicks?: number;
    rootMajorFaults?: number;
    rootBlockIoTicks?: number;
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
    'linuxIdentity',
    ...identityKeys,
    ...creationKeys,
    'outcome',
    'durationMs',
    'elapsedMs',
    'attempt',
    'count',
    'ownedDescendantCount',
    'listenerOwnerCount',
    'listenerRecordCount',
    'listenerOwnerEmittedCount',
    'listenerOwnerOmittedCount',
    'listenerOwnerRecordCount',
    'listenerOwnerPid',
    'listenerOwnerParentPid',
    'listenerOwnerUid',
    'listenerOwnerStartedAtMs',
    'rootOwnerUid',
    'rootOwnerStartedAtMs',
    'listenerOwnerRelation',
    'listenerOwnerOwned',
    'pendingCount',
    'resourceCount',
    'budgetMs',
    'remainingMs',
    'exitCode',
    'signalCode',
    'exitObserved',
    'monitoringFailed',
    'readinessExitReason',
    'rootProcessState',
    'rootStartTicks',
    'rootUserTicks',
    'rootSystemTicks',
    'rootMajorFaults',
    'rootBlockIoTicks',
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
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > keys.length) return;
    for (const key of ownKeys) {
        if (typeof key !== 'string' || !keys.includes(key)) return;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return;
        result[key] = descriptor.value;
    }
    return result;
}
function safeField(key: string, value: unknown): boolean {
    if (key === 'linuxIdentity') return validateLinuxIdentity(value) !== undefined;
    if (creationKeys.some((selected) => selected === key)) return safeCreationField(key, value);
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
    if (key === 'rootProcessState') return member(rootProcessStates, value);
    if (key === 'readinessExitReason') return member(readinessExitReasons, value);
    if (key === 'listenerOwnerRelation') return member(listenerOwnerRelations, value);
    if (key === 'signalCode') return value === null || member(signals, value);
    if (key === 'trigger') return value === 'gateway-disconnect';
    if (['stderrPresent', 'valid', 'available', 'exitObserved', 'monitoringFailed', 'listenerOwnerOwned'].includes(key))
        return typeof value === 'boolean';
    if (key === 'exitCode')
        return (
            value === null ||
            (typeof value === 'number' && Number.isInteger(value) && value >= -2_147_483_648 && value <= 4_294_967_295)
        );
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    if (['durationMs', 'timestampMs', 'elapsedMs', 'budgetMs', 'remainingMs'].includes(key)) return true;
    if (!Number.isSafeInteger(value)) return false;
    if (key === 'pid' || key === 'listenerOwnerPid') return value > 0;
    if (key === 'port') return value > 0 && value <= 65535;
    if (key === 'httpStatus') return value >= 100 && value <= 599;
    return [
        'attempt',
        'count',
        'ownedDescendantCount',
        'listenerOwnerCount',
        'listenerRecordCount',
        'listenerOwnerEmittedCount',
        'listenerOwnerOmittedCount',
        'listenerOwnerRecordCount',
        'listenerOwnerParentPid',
        'listenerOwnerUid',
        'listenerOwnerStartedAtMs',
        'rootOwnerUid',
        'rootOwnerStartedAtMs',
        'pendingCount',
        'resourceCount',
        'nativeError',
        'rootStartTicks',
        'rootUserTicks',
        'rootSystemTicks',
        'rootMajorFaults',
        'rootBlockIoTicks',
    ].includes(key);
}
function copyFields(value: FixtureFields): FixtureFields {
    const result: Record<string, unknown> = {};
    for (const key of fieldKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor && safeField(key, descriptor.value))
            result[key] = key === 'linuxIdentity' ? validateLinuxIdentity(descriptor.value) : descriptor.value;
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
        if (!validCreation(selected)) return;
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
    publishFixtureEvent(stage, event, fields, error);
}
function publishFixtureEvent(
    stage: FixtureStage,
    event: FixtureEvent['event'],
    fields: FixtureFields,
    error?: unknown,
    creationFrame?: FixtureCreationFrame,
    sourceStatEndedMs?: number,
): void {
    if (!observation.hasSubscribers) return;
    let payload: FixtureEvent;
    try {
        if (!member(stages, stage) || !member(['begin', 'end', 'decision'], event)) return;
        const scoped = current();
        if (creationFrame && !fixtureCreationFrameActive(creationFrame)) return;
        const metadata = copyFields({ ...scoped, ...fields });
        if (creationFrame && !fixtureCreationFrameActive(creationFrame)) return;
        payload = Object.freeze({
            ...metadata,
            stage,
            event,
            outcome: metadata.outcome ?? (event === 'begin' ? 'started' : event === 'end' ? 'succeeded' : 'observed'),
            timestampMs: sourceStatEndedMs ?? performance.now(),
            durationMs: metadata.durationMs ?? 0,
            ...(error === undefined ? {} : { error: errorMetadata(error) }),
        });
    } catch {
        return;
    }
    // Arbitrary diagnostics_channel subscribers are not isolated by a publisher try/catch.
    // Only subscribeFixtureDiagnostics is supported; its catch runs INSIDE its callback.
    if (creationFrame && !fixtureCreationFrameActive(creationFrame)) return;
    observation.publish(payload);
}
export function emitFixtureCreationDecision(
    frame: FixtureCreationFrame,
    fields: FixtureFields,
    sourceStatEndedMs?: number,
): void {
    if (!fixtureCreationFrameActive(frame)) return;
    if (
        sourceStatEndedMs !== undefined &&
        (!fields.linuxIdentity || !Number.isFinite(sourceStatEndedMs) || sourceStatEndedMs < 0)
    )
        return;
    publishFixtureEvent('process-creation-identity', 'decision', fields, undefined, frame, sourceStatEndedMs);
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
    aroundReceive?: (dispatch: () => void) => void,
    options: { creationIdentity?: { matches: (origin: FixtureOrigin) => boolean } } = {},
): FixtureSubscription {
    const request: CreationRequest | undefined = options.creationIdentity
        ? {
              matches: options.creationIdentity.matches,
              active: true,
              sourceAttempts: 0,
              comparisons: 0,
              tokens: 0,
              capped: false,
              disabled: false,
              revoked: false,
          }
        : undefined;
    const registry = request ? acquireCreationRegistry() : undefined;
    if (request && registry) registry.requests.add(request);
    const receive = (data: unknown) => {
        try {
            const dispatch = () => {
                const event = validateFixtureEvent(data);
                const returned: unknown = event ? callback(event) : onRejected?.();
                if (returned !== undefined) void Promise.resolve(returned).catch(() => {});
            };
            if (aroundReceive) aroundReceive(dispatch);
            else dispatch();
        } catch {
            // Node treats subscriber throws as fatal; containment belongs inside this callback.
        }
    };
    observation.subscribe(receive);
    return Object.assign(
        () => {
            observation.unsubscribe(receive);
            if (request) {
                request.active = false;
                request.revoked = true;
                if (registry) releaseCreationRequest(registry, request);
            }
        },
        {
            revokeCreationIdentity: () => {
                if (request) {
                    request.active = false;
                    request.revoked = true;
                }
            },
            creationIdentityStats: () =>
                Object.freeze({
                    sourceAttempts: request?.sourceAttempts ?? 0,
                    comparisons: request?.comparisons ?? 0,
                    tokens: request?.tokens ?? 0,
                    capped: request?.capped ?? false,
                    disabled: (request?.disabled ?? false) || (registry?.bookkeepingFailed ?? false),
                    revoked: request?.revoked ?? false,
                }),
        },
    );
}

export interface CreationIdentityStats {
    readonly sourceAttempts: number;
    readonly comparisons: number;
    readonly tokens: number;
    readonly capped: boolean;
    readonly disabled: boolean;
    readonly revoked: boolean;
}
export type FixtureSubscription = (() => void) & {
    revokeCreationIdentity(): void;
    creationIdentityStats(): CreationIdentityStats;
};
type CreationRequest = {
    matches: (origin: FixtureOrigin) => boolean;
    active: boolean;
    sourceAttempts: number;
    comparisons: number;
    tokens: number;
    capped: boolean;
    disabled: boolean;
    revoked: boolean;
};
type CreationRegistry = {
    requests: Set<unknown>;
    bookkeepingFailed: boolean;
    responder: (query: unknown) => void;
};
const registryQueryKind = 'creation-observation-registry';
function isCreationRegistry(value: unknown): value is CreationRegistry {
    const record = detachedRecord(value, ['requests', 'bookkeepingFailed', 'responder']);
    return (
        !!record &&
        record.requests instanceof Set &&
        typeof record.bookkeepingFailed === 'boolean' &&
        typeof record.responder === 'function'
    );
}
/** Only in-process references cross this private named channel, never fixture events or receipts. */
function discoverCreationRegistry(): CreationRegistry | undefined {
    if (!creationRegistryObservation.hasSubscribers) return;
    const query: { kind: string; reply: unknown } = { kind: registryQueryKind, reply: undefined };
    try {
        creationRegistryObservation.publish(query);
        const reply = Object.getOwnPropertyDescriptor(query, 'reply');
        if (reply && 'value' in reply && isCreationRegistry(reply.value)) return reply.value;
    } catch {
        const reply = Object.getOwnPropertyDescriptor(query, 'reply');
        if (reply && 'value' in reply && isCreationRegistry(reply.value)) reply.value.bookkeepingFailed = true;
    }
}
function acquireCreationRegistry(): CreationRegistry {
    const existing = discoverCreationRegistry();
    if (existing) return existing;
    const registry: CreationRegistry = {
        requests: new Set(),
        bookkeepingFailed: false,
        responder(query: unknown) {
            try {
                const record = detachedRecord(query, ['kind', 'reply']);
                if (!record || record.kind !== registryQueryKind || record.reply !== undefined || !plain(query)) return;
                const reply = Object.getOwnPropertyDescriptor(query, 'reply');
                if (!reply || !('value' in reply) || !reply.writable || !reply.configurable) return;
                Object.defineProperty(query, 'reply', { ...reply, value: registry });
            } catch {
                registry.bookkeepingFailed = true;
            }
        },
    };
    creationRegistryObservation.subscribe(registry.responder);
    return registry;
}
function releaseCreationRequest(registry: CreationRegistry, request: CreationRequest): void {
    try {
        registry.requests.delete(request);
        if (registry.requests.size === 0) creationRegistryObservation.unsubscribe(registry.responder);
    } catch {
        registry.bookkeepingFailed = true;
    }
}
function isCreationRequest(value: unknown): value is CreationRequest {
    const record = detachedRecord(value, [
        'matches',
        'active',
        'sourceAttempts',
        'comparisons',
        'tokens',
        'capped',
        'disabled',
        'revoked',
    ]);
    if (!record || typeof record.matches !== 'function') return false;
    for (const key of ['active', 'capped', 'disabled', 'revoked']) if (typeof record[key] !== 'boolean') return false;
    for (const key of ['sourceAttempts', 'comparisons', 'tokens']) {
        const count = record[key];
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 128) return false;
    }
    return true;
}
export interface FixtureCreationFrame {
    readonly origin: FixtureOrigin;
    readonly request: CreationRequest;
    readonly registry: CreationRegistry;
    compared: boolean;
}
/** Correlation preserves invalid explicit resource presence before normal serialization drops it. */
function captureCreationOrigin(resourceIdentity: Pick<FixtureIdentity, 'pid' | 'port'> | undefined): FixtureOrigin {
    const scope = scopes.getStore();
    const raw = scope ? (typeof scope === 'function' ? scope() : scope) : {};
    const fallback = { ...resourceIdentity };
    for (const key of ['pid', 'port'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(raw, key);
        if (
            descriptor &&
            (!('value' in descriptor) || (descriptor.value !== undefined && !safeField(key, descriptor.value)))
        )
            delete fallback[key];
    }
    const selected = { ...fallback, ...copyFields(raw) };
    const { operationId, requestId: _requestId, action: _action, trigger: _trigger, ...identity } = selected;
    return Object.freeze(copyFields({ ...identity, ...(operationId ? { originOperationId: operationId } : {}) }));
}
/** Admission is separate from ordinary subscriber presence and precedes added clocks. */
export function reserveFixtureCreationObservation(
    source: boolean,
    previous?: FixtureCreationFrame,
    resourceIdentity?: Pick<FixtureIdentity, 'pid' | 'port'>,
    requireSourceOrigin = false,
): FixtureCreationFrame | undefined {
    let registry: CreationRegistry | undefined;
    try {
        registry = discoverCreationRegistry();
        if (!registry || registry.bookkeepingFailed) return;
        let available = false;
        for (const request of registry.requests) {
            if (!isCreationRequest(request)) {
                registry.bookkeepingFailed = true;
                return;
            }
            if (!request.active || request.disabled) continue;
            if (
                request.tokens < 128 ||
                (!source && previous?.registry === registry && previous.request === request && !previous.compared)
            )
                available = true;
            else request.capped = true;
        }
        if (!available) return;
        const origin = captureCreationOrigin(resourceIdentity);
        if (
            requireSourceOrigin &&
            (!previous ||
                !sameFixtureOrigin(previous.origin, origin) ||
                origin.pid !== resourceIdentity?.pid ||
                origin.port !== resourceIdentity?.port)
        )
            return;
        for (const request of registry.requests) {
            if (!isCreationRequest(request)) {
                registry.bookkeepingFailed = true;
                return;
            }
            if (!request.active || request.disabled) continue;
            try {
                if (!request.matches(origin)) continue;
                if (!request.active || request.disabled || registry.bookkeepingFailed) continue;
                const reuse =
                    !source &&
                    previous?.registry === registry &&
                    previous.request === request &&
                    !previous.compared &&
                    sameFixtureOrigin(previous.origin, origin);
                if (!reuse && request.tokens >= 128) {
                    request.capped = true;
                    continue;
                }
                if (!reuse) request.tokens++;
                if (source) request.sourceAttempts++;
                else request.comparisons++;
                const frame = reuse ? previous : { origin, request, registry, compared: false };
                if (!source) frame.compared = true;
                return frame;
            } catch {
                request.disabled = true;
            }
        }
    } catch {
        if (registry) registry.bookkeepingFailed = true;
    }
}

export function fixtureCreationObservationEnabled(): boolean {
    let registry: CreationRegistry | undefined;
    try {
        registry = discoverCreationRegistry();
        if (!registry || registry.bookkeepingFailed) return false;
        for (const request of registry.requests) {
            if (!isCreationRequest(request)) {
                registry.bookkeepingFailed = true;
                return false;
            }
            if (request.active && !request.disabled) return true;
        }
    } catch {
        if (registry) registry.bookkeepingFailed = true;
    }
    return false;
}

/** Compare only the already-detached, closed scope identity used by admission. */
export function sameFixtureOrigin(left: FixtureOrigin, right: FixtureOrigin): boolean {
    return identityKeys.every((key) => left[key] === right[key]);
}

export function fixtureCreationFrameActive(frame: FixtureCreationFrame): boolean {
    return !frame.registry.bookkeepingFailed && frame.request.active && !frame.request.disabled;
}
