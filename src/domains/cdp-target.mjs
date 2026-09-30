import { DEFAULT_BASE_PORT, FIRST_USER_PORT, MAX_PORT } from '../shared/constants.mjs';

export async function choosePort({ basePort = DEFAULT_BASE_PORT, reservedRanges = [], probe }) {
    if (!Number.isInteger(basePort) || basePort < 1 || basePort > MAX_PORT) throw new Error('Invalid base port.');
    for (let port = Math.max(basePort, FIRST_USER_PORT); port <= MAX_PORT; port += 1) {
        if (reservedRanges.some(([start, end]) => port >= start && port <= end)) continue;
        if (await probe(port)) return port;
    }
    throw new Error('No available, non-reserved CDP port remains.');
}

function isLoopback(address) {
    return address === '::1' || address === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(address);
}

export function validateCdpIdentity({ endpoint, port, listeners, processIds, targetKind }) {
    const url = new URL(endpoint?.webSocketDebuggerUrl ?? 'about:blank');
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
    const browserProduct = String(endpoint?.Browser ?? '');
    if (!browserProduct) throw new Error('The CDP endpoint did not identify its browser product.');
    if (targetKind === 'chrome' && !/^Chrome\/\d+/i.test(browserProduct)) {
        throw new Error('The endpoint is not Google Chrome.');
    }
    return { browserProduct, webSocketDebuggerUrl: url.toString() };
}
