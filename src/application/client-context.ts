import type { ClientPrincipal, ClientRequestContext, ClientRequestFacilities } from '../shared/client-context.ts';

/** Detach a wait and consume late outcomes; owned executions retain their separate lifetime signal. */
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
                if (!available()) throw new RequestFailure('CLIENT_CONTEXT_UNAVAILABLE');
            }
            return {
                principal,
                requestId,
                capabilities,
                waitSignal,
                available,
                async readRoots(signal) {
                    requireAvailable();
                    const admission = signal ? AbortSignal.any([waitSignal, signal]) : waitSignal;
                    admission.throwIfAborted();
                    if (!capabilities.roots) return { roots: [] };
                    if (!readRoots) throw new RequestFailure('ROOTS_UNAVAILABLE');
                    const result = await waitForClient(readRoots(admission), admission);
                    admission.throwIfAborted();
                    requireAvailable();
                    return structuredClone(result);
                },
                async elicit(params, signal) {
                    requireAvailable();
                    if (!capabilities.formElicitation || !elicit)
                        throw new RequestFailure('FORM_ELICITATION_UNAVAILABLE');
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

import { RequestFailure } from '../domains/request-failure.ts';
