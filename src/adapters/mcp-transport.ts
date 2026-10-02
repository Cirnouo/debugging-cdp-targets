import { randomUUID } from 'node:crypto';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// SDK 1.31.0 Protocol._oncancel ignores request ID 0 because it tests truthiness.
// Alias only that ID at the transport boundary; payloads and all other IDs stay exact.
export function preserveZeroRequestCancellation(base: Transport): Transport {
    let incomingZero: string | undefined;
    let outgoingZero: string | undefined;
    const clear = () => {
        incomingZero = undefined;
        outgoingZero = undefined;
    };
    const cancellation = (message: JSONRPCMessage, replacement: string | undefined): JSONRPCMessage => {
        if (
            'method' in message &&
            message.method === 'notifications/cancelled' &&
            message.params?.requestId === 0 &&
            replacement !== undefined
        ) {
            return { ...message, params: { ...message.params, requestId: replacement } };
        }
        return message;
    };
    const transport: Transport = {
        async start() {
            base.onmessage = (message, extra) => {
                let mapped: JSONRPCMessage = message;
                if ('id' in message && 'method' in message && message.id === 0) {
                    incomingZero = `dct-incoming-${randomUUID()}`;
                    mapped = { ...message, id: incomingZero };
                } else if (
                    'id' in message &&
                    !('method' in message) &&
                    outgoingZero !== undefined &&
                    message.id === outgoingZero
                ) {
                    mapped = { ...message, id: 0 };
                    outgoingZero = undefined;
                } else {
                    mapped = cancellation(message, incomingZero);
                }
                transport.onmessage?.(mapped, extra);
            };
            base.onerror = (error) => transport.onerror?.(error);
            base.onclose = () => {
                clear();
                transport.onclose?.();
            };
            await base.start();
        },
        async send(message, options) {
            let mapped: JSONRPCMessage = message;
            if ('id' in message && 'method' in message && message.id === 0) {
                outgoingZero = `dct-outgoing-${randomUUID()}`;
                mapped = { ...message, id: outgoingZero };
            } else if (
                'id' in message &&
                !('method' in message) &&
                incomingZero !== undefined &&
                message.id === incomingZero
            ) {
                mapped = { ...message, id: 0 };
                incomingZero = undefined;
            } else {
                mapped = cancellation(message, outgoingZero);
            }
            await base.send(mapped, options);
        },
        async close() {
            clear();
            await base.close();
        },
        setProtocolVersion(version) {
            base.setProtocolVersion?.(version);
        },
    };
    return transport;
}
