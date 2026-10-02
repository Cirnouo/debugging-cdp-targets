import { parseArgs } from 'node:util';
import { type ControlRequest, parseControlRequest } from '../domains/control-contract.ts';

export function parseControlArguments(arguments_: string[]): ControlRequest {
    const [action, ...rest] = arguments_;
    if (!action || !['status', 'start', 'restart', 'stop', 'end-task'].includes(action))
        throw new Error('Unknown action. Use status, start, restart, stop, or end-task.');
    const parsed = parseArgs({
        args: rest,
        options: {
            'entry-id': { type: 'string' },
            'session-id': { type: 'string' },
            'launch-command': { type: 'string' },
            'target-kind': { type: 'string' },
            'base-port': { type: 'string' },
            disposition: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
        tokens: true,
    });
    const names = parsed.tokens.filter((token) => token.kind === 'option').map((token) => token.name);
    if (new Set(names).size !== names.length) throw new Error('Duplicate control options are prohibited.');
    const request: Record<string, unknown> = { action };
    const mapping: Record<string, string> = {
        'entry-id': 'entryId',
        'session-id': 'sessionId',
        'launch-command': 'launchCommand',
        'target-kind': 'targetKind',
        'base-port': 'basePort',
        disposition: 'disposition',
    };
    for (const [name, value] of Object.entries(parsed.values)) {
        const key = mapping[name];
        if (key) request[key] = name === 'base-port' ? (/^[0-9]+$/.test(String(value)) ? Number(value) : NaN) : value;
    }
    return parseControlRequest(request);
}
