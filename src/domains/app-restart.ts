import { isRecord } from '../shared/errors.ts';

export type AppRestartContext = Readonly<{
    type: 'restart-v1';
    installationIdentity: string;
    buildId: string;
    attemptId: string;
    receiptPath: string;
}>;
export type AppRestartChildIdentity = Readonly<{
    installationIdentity: string;
    buildId: string;
    attemptId: string;
    processId: number;
}>;

function fields(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
        throw new Error('Malformed App restart fields.');
}

function identities(value: Record<string, unknown>) {
    if (
        typeof value.installationIdentity !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.installationIdentity) ||
        typeof value.buildId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.buildId) ||
        typeof value.attemptId !== 'string' ||
        !/^[a-f0-9]{32}$/.test(value.attemptId)
    )
        throw new Error('Invalid App restart identity.');
    return { installationIdentity: value.installationIdentity, buildId: value.buildId, attemptId: value.attemptId };
}

function bounded(value: unknown): asserts value is string {
    if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 512)
        throw new Error('App restart record exceeds its UTF-8 bound.');
}

/** Syntax only: the receipt adapter must independently verify the owned private directory and file. */
export function encodeAppRestartContext(value: unknown): string {
    fields(value, ['type', 'installationIdentity', 'buildId', 'attemptId', 'receiptPath']);
    const identity = identities(value);
    if (
        value.type !== 'restart-v1' ||
        typeof value.receiptPath !== 'string' ||
        !/^(\/|[A-Za-z]:\\)/.test(value.receiptPath) ||
        /[\0\r\n]/.test(value.receiptPath) ||
        value.receiptPath.split(/[/\\]/).some((part) => part === '.' || part === '..')
    )
        throw new Error('Invalid App restart context.');
    const text = JSON.stringify({ type: 'restart-v1', ...identity, receiptPath: value.receiptPath });
    bounded(text);
    return text;
}

export function parseAppRestartContext(value: unknown): AppRestartContext {
    bounded(value);
    const parsed: unknown = JSON.parse(value);
    if (encodeAppRestartContext(parsed) !== value) throw new Error('App restart context is not canonical.');
    // Revalidate unknown output rather than treating JSON.parse as a typed value.
    fields(parsed, ['type', 'installationIdentity', 'buildId', 'attemptId', 'receiptPath']);
    if (typeof parsed.receiptPath !== 'string') throw new Error('Invalid App restart receipt path.');
    return Object.freeze({ type: 'restart-v1', ...identities(parsed), receiptPath: parsed.receiptPath });
}

export function encodeAppRestartLeaseReceipt(value: unknown): string {
    fields(value, ['installationIdentity', 'buildId', 'attemptId', 'processId']);
    const identity = identities(value);
    if (
        typeof value.processId !== 'number' ||
        !Number.isInteger(value.processId) ||
        value.processId < 1 ||
        value.processId > 4294967295
    )
        throw new Error('Invalid App restart child PID.');
    const text = `lease-held-v1 ${identity.installationIdentity} ${identity.buildId} ${identity.attemptId} ${value.processId}\n`;
    bounded(text);
    return text;
}

/** ACK means independently acquired use coverage, not singleton ownership or gateway readiness. */
export function parseAppRestartLeaseReceipt(
    value: unknown,
    expected: AppRestartChildIdentity,
): AppRestartChildIdentity {
    bounded(value);
    if (value !== encodeAppRestartLeaseReceipt(expected)) throw new Error('Unconfirmed App restart lease receipt.');
    return Object.freeze({ ...expected });
}
