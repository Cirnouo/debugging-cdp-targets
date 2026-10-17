import type { ClientPrincipal, ClientRequestContext, ClientRequestFacilities } from '../shared/client-context.ts';

/** Detach only the client response; observing the original promise consumes every late outcome. */
export function waitForClient<T>(execution: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const aborted = () => {
            signal.removeEventListener('abort', aborted);
            reject(signal.reason);
        };
        signal.addEventListener('abort', aborted, { once: true });
        void execution.then(
            (value) => {
                signal.removeEventListener('abort', aborted);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', aborted);
                reject(error);
            },
        );
        if (signal.aborted) aborted();
    });
}

/** A client lifetime gates request facilities; detaching never owns resource cleanup. */
export function createClientContext(principal: ClientPrincipal) {
    const disconnected = new AbortController();
    return {
        detach() {
            disconnected.abort(new Error('The originating client is unavailable.'));
        },
        request(facilities: ClientRequestFacilities): ClientRequestContext {
            const { requestId, readRoots, elicit, onProgress } = facilities;
            const capabilities = Object.freeze({ ...facilities.capabilities });
            const waitSignal = facilities.waitSignal
                ? AbortSignal.any([disconnected.signal, facilities.waitSignal])
                : disconnected.signal;
            const available = () => !waitSignal.aborted;
            function requireAvailable() {
                if (!available()) throw new Error('The originating client request context is unavailable.');
            }
            return {
                principal,
                requestId,
                capabilities,
                waitSignal,
                available,
                async readRoots() {
                    requireAvailable();
                    if (!capabilities.roots) return { roots: [] };
                    if (!readRoots) throw new Error('The originating client roots reader is unavailable.');
                    const result = await readRoots();
                    requireAvailable();
                    return structuredClone(result);
                },
                async elicit(params, signal) {
                    requireAvailable();
                    if (!capabilities.formElicitation || !elicit)
                        throw new Error('The originating client does not support form-mode elicitation.');
                    const result = await elicit(params, signal ? AbortSignal.any([waitSignal, signal]) : waitSignal);
                    requireAvailable();
                    return result;
                },
                progress(progress) {
                    if (available()) onProgress?.(progress);
                },
            };
        },
    };
}
