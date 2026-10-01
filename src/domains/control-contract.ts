export type TargetKind = 'chrome' | 'generic-cdp';
export type Disposition = 'Close' | 'Keep';
export interface LaunchOptions {
    launchCommand: string;
    targetKind?: TargetKind;
    basePort?: number;
}
export type ControlRequest =
    | { action: 'status' }
    | ({ action: 'start' } & LaunchOptions)
    | ({ action: 'switch'; disposition: Disposition } & LaunchOptions)
    | { action: 'stop'; disposition: Disposition };
export type TargetStatus =
    | { status: 'none' }
    | { status: 'active'; port: number; processId: number; targetKind: TargetKind };
export type ControlResult = TargetStatus & {
    disposition?: Disposition;
    previousTarget?: Disposition;
    pageIdsInvalidated?: boolean;
};
export type ControlResponse =
    | { ok: true; result: ControlResult }
    | { ok: false; error: string; details?: Record<string, unknown> };
export interface ControlHandler {
    status(): TargetStatus;
    start(options: LaunchOptions): Promise<ControlResult>;
    switch(options: LaunchOptions & { disposition: Disposition }): Promise<ControlResult>;
    stop(options: { disposition: Disposition }): Promise<ControlResult>;
}

export function parseControlRequest(value: unknown): ControlRequest {
    if (!isRecord(value)) throw new Error('Invalid control request.');
    const action = value.action;
    if (action === 'status') return { action };
    const disposition = value.disposition;
    if (action === 'stop' || action === 'switch') {
        if (disposition !== 'Close' && disposition !== 'Keep') throw new Error('Choose Close or Keep.');
        if (action === 'stop') return { action, disposition };
    }
    if (action !== 'start' && action !== 'switch') throw new Error('Unknown control action.');
    if (typeof value.launchCommand !== 'string' || !value.launchCommand.trim())
        throw new Error('A launch command is required.');
    if (value.targetKind !== undefined && value.targetKind !== 'chrome' && value.targetKind !== 'generic-cdp')
        throw new Error('Unknown target kind.');
    if (
        value.basePort !== undefined &&
        (typeof value.basePort !== 'number' ||
            !Number.isInteger(value.basePort) ||
            value.basePort < 1 ||
            value.basePort > 65535)
    )
        throw new Error('Base port is invalid.');
    const options: LaunchOptions = {
        launchCommand: value.launchCommand,
        ...(value.targetKind === undefined ? {} : { targetKind: value.targetKind }),
        ...(value.basePort === undefined ? {} : { basePort: value.basePort }),
    };
    if (action === 'switch' && (disposition === 'Close' || disposition === 'Keep'))
        return { action, ...options, disposition };
    return { action: 'start', ...options };
}

export function parseControlResponse(value: unknown): ControlResponse {
    if (!isRecord(value)) throw new Error('Invalid control response.');
    if (value.ok === false && typeof value.error === 'string') {
        if (value.details !== undefined && !isRecord(value.details)) throw new Error('Invalid error details.');
        return { ok: false, error: value.error, ...(value.details === undefined ? {} : { details: value.details }) };
    }
    const result = value.result;
    if (value.ok !== true || !isRecord(result)) throw new Error('Invalid control result.');
    if (
        result.status !== 'none' &&
        !(
            result.status === 'active' &&
            typeof result.port === 'number' &&
            typeof result.processId === 'number' &&
            (result.targetKind === 'chrome' || result.targetKind === 'generic-cdp')
        )
    )
        throw new Error('Invalid target status.');
    for (const key of ['disposition', 'previousTarget'])
        if (result[key] !== undefined && result[key] !== 'Close' && result[key] !== 'Keep')
            throw new Error('Invalid disposition.');
    if (result.pageIdsInvalidated !== undefined && typeof result.pageIdsInvalidated !== 'boolean')
        throw new Error('Invalid page invalidation marker.');
    // Validated above at the IPC boundary, including every optional member.
    return { ok: true, result: result as ControlResult };
}

import { isRecord } from '../shared/errors.ts';
