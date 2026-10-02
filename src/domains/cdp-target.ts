import { DEFAULT_BASE_PORT, FIRST_USER_PORT, MAX_PORT } from '../shared/constants.ts';
import { DetailedError, isRecord } from '../shared/errors.ts';
import type { TargetKind } from './control-contract.ts';

export type PortRange = readonly [number, number];
export interface ListenerEvidence {
    localAddress: string;
    owningProcess: number;
}
export interface ProcessTarget {
    processId: number;
    port: number;
    executablePath: string;
    startedAtUtc: string;
    targetKind: TargetKind;
}
export type RootEvidence =
    | { exists: false }
    | {
          exists: true;
          executablePath: string;
          sessionId: number;
          startedAtUtc: string;
          productName?: string;
          companyName?: string;
      };
export interface ProcessEvidence {
    root: RootEvidence;
    currentSessionId: number;
    processIds: number[];
    listeners: ListenerEvidence[];
}
export interface ManagedTarget extends ProcessTarget {
    launchDefinition?: { executablePath: string; arguments: string[]; cwd: string };
    browserProduct?: string;
    webSocketDebuggerUrl?: string;
    verify?: () => Promise<void>;
    child?: { once(event: 'exit', listener: () => void): unknown };
}

/** Internal ownership evidence for a new process whose normal rollback failed. */
export class RetainedTargetError extends DetailedError {
    readonly target: ManagedTarget;

    constructor(message: string, target: ManagedTarget) {
        super(message);
        this.target = target;
        Object.defineProperty(this, 'target', { enumerable: false });
    }
}

export async function choosePort({
    basePort = DEFAULT_BASE_PORT,
    reservedRanges = [],
    probe,
}: {
    basePort?: number;
    reservedRanges?: readonly PortRange[];
    probe: (port: number) => Promise<boolean>;
}) {
    if (!Number.isInteger(basePort) || basePort < 1 || basePort > MAX_PORT) throw new Error('Invalid base port.');
    for (let port = Math.max(basePort, FIRST_USER_PORT); port <= MAX_PORT; port += 1) {
        if (reservedRanges.some(([start, end]) => port >= start && port <= end)) continue;
        if (await probe(port)) return port;
    }
    throw new Error('No available, non-reserved CDP port remains.');
}

function isLoopback(address: string) {
    return address === '::1' || address === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(address);
}

export function validateCdpIdentity({
    endpoint,
    port,
    listeners,
    processIds,
    targetKind,
}: {
    endpoint: unknown;
    port: number;
    listeners: ListenerEvidence[];
    processIds: number[];
    targetKind?: TargetKind;
}) {
    const value = isRecord(endpoint) ? endpoint : {};
    const url = new URL(typeof value.webSocketDebuggerUrl === 'string' ? value.webSocketDebuggerUrl : 'about:blank');
    if (url.protocol !== 'ws:' || Number(url.port) !== port || !isLoopback(url.hostname)) {
        throw new Error('The CDP WebSocket endpoint has an unexpected host or port.');
    }
    if (!/^\/devtools\/browser\/[^/]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) {
        throw new Error('The CDP WebSocket endpoint is not a browser-level endpoint.');
    }
    if (!Array.isArray(listeners) || listeners.length === 0) throw new Error('The CDP listener cannot be verified.');
    if (listeners.some(({ localAddress }) => !isLoopback(localAddress))) {
        throw new Error('The CDP listener is exposed outside loopback.');
    }
    const owned = new Set(processIds.map(Number));
    if (listeners.some(({ owningProcess }) => !owned.has(Number(owningProcess)))) {
        throw new Error('The CDP listener owner does not belong to the new target process tree.');
    }
    if (!listeners.some(({ localAddress }) => localAddress === '127.0.0.1')) {
        throw new Error('The IPv4 loopback CDP listener is missing.');
    }
    const browserProduct = typeof value.Browser === 'string' ? value.Browser : '';
    if (!browserProduct) throw new Error('The CDP endpoint did not identify its browser product.');
    if (targetKind === 'chrome' && !/^Chrome\/\d+/i.test(browserProduct)) {
        throw new Error('The endpoint is not Google Chrome.');
    }
    return { browserProduct, webSocketDebuggerUrl: url.toString() };
}
