import { fail } from '../../shared/errors.mjs';
import { isIntegerInRange, normalizePath } from '../../shared/values.mjs';
import { DEFAULT_BASE_PORT } from '../../shared/constants.mjs';

export function validateChromeFileIdentity(root, targetAdapter) {
    if (targetAdapter !== 'chrome') return true;
    const valid = root.productName === 'Google Chrome'
        && root.companyName === 'Google LLC'
        && String(root.originalFilename).toLocaleLowerCase('en-US') === 'chrome.exe';
    if (!valid) fail('TARGET_IDENTITY_MISMATCH', 'The chrome target adapter requires an executable identified by Windows as Google Chrome.');
    return true;
}

export function validateRootSnapshot({ snapshot, executablePath, startedAtUtc, targetAdapter }) {
    if (!snapshot?.root?.exists) fail('TARGET_IDENTITY_MISMATCH', 'The recorded root process does not exist.');
    const recorded = Date.parse(startedAtUtc);
    const actual = Date.parse(snapshot.root.startedAtUtc);
    const valid = normalizePath(snapshot.root.executablePath) === normalizePath(executablePath)
        && snapshot.root.sessionId === snapshot.currentSessionId
        && Number.isFinite(recorded)
        && Number.isFinite(actual)
        && Math.abs(actual - recorded) <= 1000;
    if (!valid) fail('TARGET_IDENTITY_MISMATCH', 'The root process path, Windows session, or creation time does not match.');
    validateChromeFileIdentity(snapshot.root, targetAdapter);
    return true;
}

export function validateNewRootSnapshot({ snapshot, executablePath, launchedAtUtc, targetAdapter }) {
    if (!snapshot?.root?.exists) fail('TARGET_IDENTITY_MISMATCH', 'The newly launched root process does not exist.');
    const launchedAt = Date.parse(launchedAtUtc);
    const actual = Date.parse(snapshot.root.startedAtUtc);
    const valid = normalizePath(snapshot.root.executablePath) === normalizePath(executablePath)
        && snapshot.root.sessionId === snapshot.currentSessionId
        && Number.isFinite(launchedAt)
        && Number.isFinite(actual)
        && actual >= launchedAt - 1000
        && actual <= Date.now() + 1000;
    if (!valid) fail('TARGET_IDENTITY_MISMATCH', 'The newly launched root process path, Windows session, or creation time does not match.');
    validateChromeFileIdentity(snapshot.root, targetAdapter);
    return snapshot.root.startedAtUtc;
}

export async function findLoopbackPort({ basePort = DEFAULT_BASE_PORT, probe } = {}) {
    if (!isIntegerInRange(basePort, 1, 65535)) {
        fail('PORT_INVALID', 'BasePort must be an integer from 1 through 65535.');
    }
    for (let candidate = basePort; candidate <= 65535; candidate += 1) {
        const result = await probe(candidate);
        if (!result || typeof result.available !== 'boolean') {
            fail('PORT_PROBE_INVALID', `The port probe returned an invalid result for port ${candidate}.`);
        }
        if (result.available) return { port: candidate, probe: result };
    }
    fail('PORT_RANGE_EXHAUSTED', `No loopback port is available from ${basePort} through 65535.`);
}

export async function runPortTransaction({
    basePort = DEFAULT_BASE_PORT,
    probe,
    tryCandidate,
}) {
    if (typeof tryCandidate !== 'function') fail('PORT_TRANSACTION_INVALID', 'A candidate transaction function is required.');
    if (!isIntegerInRange(basePort, 1, 65535)) fail('PORT_INVALID', 'BasePort must be an integer from 1 through 65535.');

    for (let candidate = basePort; candidate <= 65535; candidate += 1) {
        const probeResult = await probe(candidate);
        if (!probeResult || typeof probeResult.available !== 'boolean') {
            fail('PORT_PROBE_INVALID', `The port probe returned an invalid result for port ${candidate}.`);
        }
        if (!probeResult.available) continue;

        const attempt = await tryCandidate(candidate, probeResult);
        if (!attempt || typeof attempt.outcome !== 'string') {
            fail('PORT_TRANSACTION_INVALID', `The target launch returned no outcome for port ${candidate}.`);
        }
        if (attempt.outcome === 'success') return attempt;
        if (attempt.outcome === 'port-race') continue;
        if (attempt.outcome === 'fatal') {
            fail(attempt.code || 'TARGET_LAUNCH_FAILED', attempt.message || `The target could not establish a verified CDP endpoint on port ${candidate}.`, attempt.details);
        }
        fail('PORT_TRANSACTION_INVALID', `Unknown port transaction outcome '${attempt.outcome}'.`);
    }
    fail('PORT_RANGE_EXHAUSTED', `No loopback port is available from ${basePort} through 65535.`);
}

export function buildTargetArguments({ targetAdapter, port, launchArguments = [], chromeProfilePath }) {
    if (!['chrome', 'generic-cdp'].includes(targetAdapter)) fail('TARGET_ADAPTER_INVALID', 'Target adapter must be chrome or generic-cdp.');
    if (!isIntegerInRange(port, 1, 65535)) fail('PORT_INVALID', 'The remote debugging port is invalid.');
    for (const argument of launchArguments) {
        if (/^--remote-debugging-(?:port|address)(?:=|$)/i.test(argument)) {
            fail('RUNNER_ARGUMENT_CONFLICT', 'Launch arguments must not override runner-owned remote debugging switches.');
        }
        if (targetAdapter === 'chrome' && /^--(?:user-data-dir|no-first-run|no-default-browser-check)(?:=|$)/i.test(argument)) {
            fail('RUNNER_ARGUMENT_CONFLICT', 'Chrome launch arguments must not override the runner-owned profile or first-run switches.');
        }
    }

    const arguments_ = [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
    ];
    if (targetAdapter === 'chrome') {
        if (!chromeProfilePath) fail('CHROME_PROFILE_REQUIRED', 'A dedicated Chrome profile path is required for Chrome targets.');
        arguments_.push(
            `--user-data-dir=${chromeProfilePath}`,
            '--no-first-run',
            '--no-default-browser-check',
        );
    }
    return [...arguments_, ...launchArguments];
}

export function isLoopbackAddress(address) {
    const normalized = String(address).replace(/^\[|\]$/g, '').split('%')[0].toLocaleLowerCase('en-US');
    if (normalized === 'localhost') return true;
    if (normalized === '::1') return true;
    if (/^127(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(normalized)) return normalized.split('.').every((part) => Number(part) <= 255);
    return false;
}

export function isVerifiedPortRace({ snapshot, failureCode }) {
    if (!['CDP_TIMEOUT', 'CDP_OWNER_MISMATCH', 'TARGET_EXITED'].includes(failureCode)) return false;
    const processIds = new Set((snapshot?.processIds || []).map(Number));
    const listeners = snapshot?.listeners || [];
    if (listeners.some((listener) => !isLoopbackAddress(listener.localAddress))) return false;
    return listeners.some((listener) => isLoopbackAddress(listener.localAddress) && !processIds.has(Number(listener.owningProcess)));
}

export function extractBrowserMajor(browserProduct) {
    const chromeMatch = String(browserProduct).match(/(?:^|\s)Chrome\/(\d+)/i);
    if (chromeMatch) return Number(chromeMatch[1]);
    const genericMatch = String(browserProduct).match(/\/(\d+)/);
    return genericMatch ? Number(genericMatch[1]) : 0;
}

export function validateWebSocketDebuggerUrl(webSocketDebuggerUrl, port) {
    if (typeof webSocketDebuggerUrl !== 'string' || webSocketDebuggerUrl.length === 0) {
        fail('CDP_WEBSOCKET_MISSING', 'The CDP version endpoint did not provide webSocketDebuggerUrl.');
    }
    let webSocketUrl;
    try {
        webSocketUrl = new URL(webSocketDebuggerUrl);
    } catch {
        fail('CDP_WEBSOCKET_INVALID', 'The CDP WebSocket URL is invalid.');
    }
    if (webSocketUrl.protocol !== 'ws:') fail('CDP_WEBSOCKET_INVALID', 'The CDP endpoint did not provide a plain local WebSocket URL.');
    if (Number(webSocketUrl.port) !== port) fail('CDP_WEBSOCKET_PORT_MISMATCH', 'The CDP WebSocket URL uses a different port.');
    if (!isLoopbackAddress(webSocketUrl.hostname)) fail('CDP_WEBSOCKET_HOST_MISMATCH', 'The CDP WebSocket URL does not use a loopback host.');
    if (
        webSocketUrl.username
        || webSocketUrl.password
        || webSocketUrl.search
        || webSocketUrl.hash
        || !/^\/devtools\/browser\/[^/]+$/.test(webSocketUrl.pathname)
    ) {
        fail('CDP_WEBSOCKET_INVALID', 'The CDP WebSocket URL contains credentials or an unexpected path.');
    }
    return webSocketDebuggerUrl;
}

export function validateCdpContract({ port, endpoint, listeners, allowedProcessIds, targetAdapter }) {
    const webSocketDebuggerUrl = endpoint?.webSocketDebuggerUrl;
    validateWebSocketDebuggerUrl(webSocketDebuggerUrl, port);

    const normalizedListeners = (listeners || []).map((listener) => ({
        localAddress: listener.localAddress ?? listener.LocalAddress,
        owningProcess: Number(listener.owningProcess ?? listener.OwningProcess),
    }));
    if (normalizedListeners.some((listener) => !isLoopbackAddress(listener.localAddress))) {
        fail('CDP_EXPOSED', 'The CDP port is listening on a non-loopback address.');
    }
    const allowed = new Set(allowedProcessIds.map(Number));
    const ipv4Listeners = normalizedListeners.filter((listener) => listener.localAddress === '127.0.0.1');
    if (ipv4Listeners.length === 0 || !ipv4Listeners.some((listener) => allowed.has(listener.owningProcess))) {
        fail('CDP_OWNER_MISMATCH', 'The IPv4 CDP listener is not owned by the newly started process tree.');
    }
    if (normalizedListeners.some((listener) => !allowed.has(listener.owningProcess))) {
        fail('CDP_OWNER_MISMATCH', 'A loopback CDP listener is owned by a process outside the newly started process tree.');
    }

    const browserProduct = String(endpoint.Browser || endpoint.browser || '');
    if (!browserProduct) fail('CDP_PRODUCT_MISSING', 'The CDP version endpoint did not identify its browser product.');
    if (targetAdapter === 'chrome' && !/^Chrome\/\d+/i.test(browserProduct)) {
        fail('CDP_PRODUCT_MISMATCH', 'A Chrome target must identify as Google Chrome.');
    }
    const browserMajorVersion = extractBrowserMajor(browserProduct);
    if (!browserMajorVersion) fail('CDP_PRODUCT_MISMATCH', 'The browser major version could not be determined.');
    return { browserProduct, browserMajorVersion, webSocketDebuggerUrl };
}
