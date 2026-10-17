import type { Tool } from '@modelcontextprotocol/client';
import type { ControlRequest } from '../domains/control-contract.ts';

export const LIFECYCLE_ACTIONS: Record<string, ControlRequest['action']> = {
    dct_connection_status: 'status',
    dct_connection_start: 'start',
    dct_connection_restart: 'restart',
    dct_connection_stop: 'stop',
    dct_operation_wait: 'wait',
    dct_operation_cancel: 'cancel',
};
export function lifecycleTools(): Tool[] {
    const uuid = { type: 'string', format: 'uuid' };
    const stringList = { type: 'array', items: { type: 'string' } };
    const identity = {
        registrationBearer: { type: 'string', minLength: 32, maxLength: 128 },
        connectionId: uuid,
        sessionId: uuid,
        requestId: { type: 'string', minLength: 1, maxLength: 128 },
    };
    const make = (
        name: string,
        description: string,
        properties: NonNullable<Tool['inputSchema']['properties']>,
        required: string[] = [],
    ): Tool => ({
        name,
        description,
        inputSchema: { type: 'object', properties, required, additionalProperties: false },
    });
    return [
        make(
            'dct_registration_register',
            'Create a memory-only registration. Save the returned bearer for every subsequent lifecycle and official tool call. The bearer is returned once, cannot be recovered, and owns resources independently of client/chat/session lifetime.',
            {},
        ),
        make(
            'dct_connection_status',
            'Read only this registration’s connections or operation, or request toolNames to inspect configuration requirements. Every call requires its registrationBearer. Selected connections accept include for configuration or diagnostics; operation selection cannot combine other selectors.',
            {
                registrationBearer: identity.registrationBearer,
                connectionId: uuid,
                operationId: uuid,
                toolNames: stringList,
                include: {
                    type: 'array',
                    items: { type: 'string', enum: ['configuration', 'diagnostics'] },
                    uniqueItems: true,
                },
            },
            ['registrationBearer'],
        ),
        make(
            'dct_connection_start',
            'Launch a new application natively and create an independent official MCP connection. Required isolation selects none or an existing/new managed data directory and explicit cleanup. Data-dir requires researched {dataDir} binding in args/env; none forbids it. Returns an operation immediately; use dct_operation_wait for completion and explicit operation metadata for directory evidence. Reuse requestId only when retrying the same request. The plugin detects Windows elevation requirements. Port placeholders are supported in args and env. cwd is not file-access authorization; use the official --workspace argument in mcpArgs.',
            {
                registrationBearer: identity.registrationBearer,
                requestId: identity.requestId,
                launch: {
                    type: 'object',
                    properties: {
                        executable: { type: 'string', description: 'Absolute executable path.' },
                        args: stringList,
                        cwd: { type: 'string' },
                        env: { type: 'object', additionalProperties: { type: 'string' } },
                    },
                    required: ['executable'],
                    additionalProperties: false,
                },
                mcpArgs: stringList,
                isolation: {
                    oneOf: [
                        {
                            type: 'object',
                            properties: { mode: { const: 'none' } },
                            required: ['mode'],
                            additionalProperties: false,
                        },
                        {
                            type: 'object',
                            properties: {
                                mode: { const: 'data-dir' },
                                cleanup: { type: 'string', enum: ['retain', 'delete-on-release'] },
                                directory: {
                                    oneOf: [
                                        {
                                            type: 'object',
                                            properties: { kind: { const: 'existing' }, path: { type: 'string' } },
                                            required: ['kind', 'path'],
                                            additionalProperties: false,
                                        },
                                        {
                                            type: 'object',
                                            properties: {
                                                kind: { const: 'new' },
                                                parent: { type: 'string' },
                                                name: { type: 'string' },
                                            },
                                            required: ['kind', 'parent'],
                                            additionalProperties: false,
                                        },
                                    ],
                                },
                            },
                            required: ['mode', 'directory', 'cleanup'],
                            additionalProperties: false,
                        },
                    ],
                },
                targetKind: { type: 'string', enum: ['chrome', 'generic-cdp'] },
                basePort: { type: 'integer', minimum: 1, maximum: 65535 },
            },
            ['registrationBearer', 'requestId', 'launch', 'isolation'],
        ),
        make(
            'dct_connection_restart',
            'Explicitly restart the target, official Server or both using the immutable original launch, environment, roots and official options. Explicit fixed ports remain fixed; automatic port policy may select a new free port. Keeps connectionId and creates a new sessionId. Scope is required. Changed configuration requires Close and a new start. Never restart or replay tools automatically.',
            {
                ...identity,
                scope: { type: 'string', enum: ['target', 'official', 'both'] },
            },
            [...Object.keys(identity), 'scope'],
        ),
        make(
            'dct_connection_stop',
            'Apply the user’s Close or Keep choice to this connection. Close requests normal application shutdown and closes its upstream only; Keep retains both. Ask Close/Keep before ending target work. Returns an operation for waiting or cancellation.',
            {
                ...identity,
                disposition: { type: 'string', enum: ['Close', 'Keep'] },
            },
            [...Object.keys(identity), 'disposition'],
        ),
        make(
            'dct_operation_wait',
            'Wait up to 25 seconds for operation events or a final result. Replay uses the returned cursor. Continue waiting with that cursor when incomplete; cancelling this wait leaves the operation running.',
            {
                registrationBearer: identity.registrationBearer,
                operationId: uuid,
                cursor: { type: 'integer', minimum: 0 },
            },
            ['registrationBearer', 'operationId'],
        ),
        make(
            'dct_operation_cancel',
            'Cancel this operation and perform actual cleanup. Cancellation may remain in progress during Windows authorization or normal close. Wait for the terminal result; failed cleanup preserves target identity for retry.',
            {
                registrationBearer: identity.registrationBearer,
                operationId: uuid,
            },
            ['registrationBearer', 'operationId'],
        ),
    ];
}
