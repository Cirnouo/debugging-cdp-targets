import { isRecord } from '../shared/errors.ts';

export type AppParentIdentity = Readonly<{ processId: number; startedAtUtc: string; executablePath: string }>;
export type AppParentExitObserver = Readonly<{
    ready: Promise<void>;
    exited: Promise<void>;
    dispose(): Promise<void>;
}>;
type ParentWatch = Readonly<{ ready: Promise<unknown>; exited: Promise<unknown>; dispose(): Promise<void> }>;

function validate(value: unknown, parent: AppParentIdentity, exited: boolean) {
    const fields = ['event', 'processId', 'startedAtUtc', 'executablePath'];
    if (exited) fields.push('processExited', 'waitResult', 'waitError', 'exitCode');
    if (
        !isRecord(value) ||
        Object.keys(value).length !== fields.length ||
        fields.some((field) => !Object.hasOwn(value, field)) ||
        value.event !== (exited ? 'parent-exited-v1' : 'parent-ready-v1') ||
        value.processId !== parent.processId ||
        value.startedAtUtc !== parent.startedAtUtc ||
        value.executablePath !== parent.executablePath ||
        (exited &&
            (value.processExited !== true ||
                value.waitResult !== 0 ||
                value.waitError !== 0 ||
                !Number.isInteger(value.exitCode)))
    )
        throw new Error('Read-only parent observation lacks exact native identity/exit evidence.');
}

/**
 * Controlled producer boundary only; no shipped native watch is implemented here.
 * A producer must inspect/retain the exact same-account App handle before ready,
 * and wait read-only on it. Existing Close observers cannot supply this boundary.
 */
export async function prepareAppParentExit(
    parent: AppParentIdentity,
    watch: (parent: AppParentIdentity) => Promise<ParentWatch>,
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
    const ready = source.ready.then((value) => validate(value, expected, false));
    const exited = source.exited.then((value) => validate(value, expected, true));
    // Observation failure remains available to the owner; it never synthesizes exit.
    void ready.catch(() => {});
    void exited.catch(() => {});
    return Object.freeze({ ready, exited, dispose: () => source.dispose() });
}
