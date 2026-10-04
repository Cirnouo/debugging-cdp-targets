import type { Tool } from '@modelcontextprotocol/client';
import type { ControlRequest } from '../domains/control-contract.ts';

export const LIFECYCLE_ACTIONS: Record<string, ControlRequest['action']> = {
    dct_connection_status: 'status',
    dct_connection_start: 'start',
    dct_connection_restart: 'restart',
    dct_connection_stop: 'stop',
    dct_connection_end_task: 'end-task',
    dct_operation_wait: 'wait',
    dct_operation_cancel: 'cancel',
};
export function lifecycleTools(hookEvents: readonly string[]): Tool[] {
    const uuid = { type: 'string', format: 'uuid' };
    const stringList = { type: 'array', items: { type: 'string' } };
    const identity = {
        entryId: uuid,
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
            'dct_connection_status',
            'Discover this gateway with empty arguments. Otherwise specify entryId; select a connection or operation, or request toolNames to inspect configuration requirements before starting. hookEventName is reserved for automatic Codex Hooks.',
            {
                entryId: uuid,
                connectionId: uuid,
                operationId: uuid,
                toolNames: stringList,
                hookEventName: { type: 'string', enum: [...hookEvents] },
            },
        ),
        make(
            'dct_connection_start',
            'Launch a new application natively and create an independent official MCP connection. Returns an operation immediately; use dct_operation_wait for completion. Reuse requestId only when retrying the same request. The plugin detects Windows elevation requirements. Port placeholders are supported in args and env. cwd is not file-access authorization; use the official --workspace argument in mcpArgs.',
            {
                entryId: uuid,
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
                targetKind: { type: 'string', enum: ['chrome', 'generic-cdp'] },
                basePort: { type: 'integer', minimum: 1, maximum: 65535 },
            },
            ['entryId', 'requestId', 'launch'],
        ),
        make(
            'dct_connection_restart',
            'Explicitly restart this connection with the same application and port, optionally replacing all mcpArgs. Keeps connectionId and creates a new sessionId; old page IDs and routes expire. Never restart or replay tools automatically.',
            {
                ...identity,
                mcpArgs: stringList,
            },
            Object.keys(identity),
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
            'dct_connection_end_task',
            'End current work for the identified session while retaining its live application and upstream connection.',
            identity,
            Object.keys(identity),
        ),
        make(
            'dct_operation_wait',
            'Wait up to 25 seconds for operation events or a final result. Replay uses the returned cursor. Continue waiting with that cursor when incomplete; cancelling this wait leaves the operation running.',
            {
                entryId: uuid,
                operationId: uuid,
                cursor: { type: 'integer', minimum: 0 },
            },
            ['entryId', 'operationId'],
        ),
        make(
            'dct_operation_cancel',
            'Cancel this operation and perform actual cleanup. Cancellation may remain in progress during Windows authorization or normal close. Wait for the terminal result; failed cleanup preserves target identity for retry.',
            {
                entryId: uuid,
                operationId: uuid,
            },
            ['entryId', 'operationId'],
        ),
    ];
}
