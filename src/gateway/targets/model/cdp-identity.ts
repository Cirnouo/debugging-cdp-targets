import type { TargetKind } from '../../../domains/control-contract.ts';
import { isRecord } from '../../../shared/errors.ts';
import type { ListenerEvidence } from './target-contract.ts';

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
