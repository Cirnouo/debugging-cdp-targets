import { isRecord } from '../shared/errors.ts';

export type AppParentIdentity = Readonly<{ processId: number; startedAtUtc: string; executablePath: string }>;
export type AppParentExitObserver = Readonly<{
    ready: Promise<void>;
    exited: Promise<void>;
    dispose(): Promise<void>;
}>;
export type AppParentWatch = Readonly<{
    /** Selected by the trusted platform factory, never by an input record. */
    method: 'windows-handle' | 'unix-absence';
    ready: Promise<unknown>;
    exited: Promise<unknown>;
    dispose(): Promise<void>;
}>;

function validate(value: unknown, parent: AppParentIdentity, method: AppParentWatch['method'], exited: boolean) {
    const fields = ['event', 'processId', 'startedAtUtc', 'executablePath'];
    const windows = method === 'windows-handle';
    if (exited)
        fields.push(...(windows ? ['processExited', 'waitResult', 'waitError', 'exitCode'] : ['processAbsent']));
    if (
        !isRecord(value) ||
        Object.keys(value).length !== fields.length ||
        fields.some((field) => !Object.hasOwn(value, field)) ||
        value.event !== (exited ? (windows ? 'parent-exited-v1' : 'parent-absent-v1') : 'parent-ready-v1') ||
        value.processId !== parent.processId ||
        value.startedAtUtc !== parent.startedAtUtc ||
        value.executablePath !== parent.executablePath ||
        (exited &&
            windows &&
            (value.processExited !== true ||
                value.waitResult !== 0 ||
                value.waitError !== 0 ||
                !Number.isInteger(value.exitCode))) ||
        (exited && !windows && value.processAbsent !== true)
    )
        throw new Error('Read-only parent observation lacks exact native identity/exit evidence.');
}

/**
 * A trusted producer proves native account/parent identity before ready. Windows
 * retains a handle; Unix positively observes exact-parent absence without status.
 * Existing Close observers cannot supply this read-only boundary.
 */
export async function prepareAppParentExit(
    parent: AppParentIdentity,
    watch: (parent: AppParentIdentity) => Promise<AppParentWatch>,
): Promise<AppParentExitObserver> {
    if (
        !Number.isInteger(parent.processId) ||
        parent.processId < 1 ||
        parent.processId > 4294967295 ||
        typeof parent.startedAtUtc !== 'string' ||
        !Number.isFinite(Date.parse(parent.startedAtUtc)) ||
        typeof parent.executablePath !== 'string' ||
        !/^(\/|[A-Za-z]:\\)/.test(parent.executablePath) ||
        /[\0\r\n]/.test(parent.executablePath)
    )
        throw new Error('Invalid App parent identity.');
    const expected = Object.freeze({ ...parent });
    const source = await watch(expected);
    if (source.method !== 'windows-handle' && source.method !== 'unix-absence') {
        await source.dispose();
        throw new Error('Unknown native parent observation method.');
    }
    const ready = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    let acknowledged = false;
    let disposed = false;
    const fail = (error: unknown) => {
        ready.reject(error);
        exited.reject(error);
    };
    void source.ready
        .then((value) => {
            if (disposed) return;
            validate(value, expected, source.method, false);
            acknowledged = true;
            ready.resolve();
        })
        .catch(fail);
    void source.exited
        .then((value) => {
            if (!acknowledged || disposed)
                throw new Error('Parent terminal evidence preceded readiness or followed disposal.');
            validate(value, expected, source.method, true);
            exited.resolve();
        })
        .catch(fail);
    // Observation failure remains available to the owner; it never synthesizes exit.
    void ready.promise.catch(() => {});
    void exited.promise.catch(() => {});
    return Object.freeze({
        ready: ready.promise,
        exited: exited.promise,
        dispose: async () => {
            disposed = true;
            fail(new Error('Parent observation disposed.'));
            await source.dispose();
        },
    });
}
