import { parseArgs } from 'node:util';
import type { ControlRequest } from '../domains/control-contract.ts';

const ACTIONS = new Set(['status', 'start', 'switch', 'stop']);

export function parseControlArguments(arguments_: string[]): ControlRequest {
    const [action, ...rest] = arguments_;
    if (!action || !ACTIONS.has(action)) throw new Error('Unknown action. Use status, start, switch, or stop.');
    const parsed = parseArgs({
        args: rest,
        options: {
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
    const values = parsed.values;
    if (action === 'status' && Object.keys(values).length > 0) throw new Error('Status takes no options.');
    if (['start', 'switch'].includes(action) && !values['launch-command']) {
        throw new Error('A --launch-command is required.');
    }
    if (['switch', 'stop'].includes(action) && !['Close', 'Keep'].includes(values.disposition ?? '')) {
        throw new Error('Choose --disposition Close or Keep.');
    }
    if (action === 'start' && values.disposition) throw new Error('Start does not accept a disposition.');
    if (
        ['status', 'stop'].includes(action) &&
        (values['launch-command'] || values['target-kind'] || values['base-port'])
    ) {
        throw new Error(`${action} does not accept target launch options.`);
    }
    if (values['target-kind'] && !['chrome', 'generic-cdp'].includes(values['target-kind'])) {
        throw new Error('Target kind must be chrome or generic-cdp.');
    }
    const basePort = values['base-port'] === undefined ? 9222 : Number(values['base-port']);
    if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) throw new Error('Base port is invalid.');
    if (action === 'status') return { action };
    const disposition = values.disposition;
    if (action === 'stop') {
        if (disposition !== 'Close' && disposition !== 'Keep') throw new Error('Choose --disposition Close or Keep.');
        return { action, disposition };
    }
    const launchCommand = values['launch-command'];
    const targetKind = values['target-kind'] ?? 'generic-cdp';
    if (!launchCommand || (targetKind !== 'chrome' && targetKind !== 'generic-cdp'))
        throw new Error('Invalid launch options.');
    if (action === 'switch') {
        if (disposition !== 'Close' && disposition !== 'Keep') throw new Error('Choose --disposition Close or Keep.');
        return { action, launchCommand, targetKind, basePort, disposition };
    }
    if (action !== 'start') throw new Error('Unknown control action.');
    return {
        action,
        launchCommand,
        targetKind,
        basePort,
    };
}
