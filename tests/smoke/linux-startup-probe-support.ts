import { targetExitObserved } from '../../src/adapters/platform-process.ts';
import type { createTargetHost } from '../../src/adapters/target-host.ts';
import type { ManagedTarget } from '../../src/domains/cdp-target.ts';
import type { LaunchOptions } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';

export function boundedProbeError(error: unknown): Record<string, unknown> {
    const seen = new Set<object>();
    function visit(value: unknown, depth: number): Record<string, unknown> {
        if (!isRecord(value)) return { message: String(value).slice(0, 240) };
        if (depth >= 4 || seen.has(value)) return { truncated: true };
        seen.add(value);
        const result: Record<string, unknown> = {};
        for (const key of ['name', 'message', 'code', 'errno', 'syscall', 'address', 'port']) {
            const field = value[key];
            if (typeof field === 'string') result[key] = field.slice(0, 240);
            else if (typeof field === 'number' && Number.isFinite(field)) result[key] = field;
        }
        if (value.cause !== undefined) result.cause = visit(value.cause, depth + 1);
        if (Array.isArray(value.errors)) {
            result.errors = value.errors.slice(0, 3).map((nested: unknown) => visit(nested, depth + 1));
            if (value.errors.length > 3) result.truncated = true;
        }
        return result;
    }
    return visit(error, 0);
}

export async function runOwnedStartupProbe(
    host: Pick<ReturnType<typeof createTargetHost>, 'launch' | 'close'>,
    options: LaunchOptions,
    record: (event: Record<string, unknown>) => void = () => {},
) {
    let owned: ManagedTarget | undefined;
    let result: ManagedTarget | undefined;
    let startupFailure: { error: unknown } | undefined;
    try {
        result = await host.launch(options, {
            onCreated(target) {
                owned = target;
                record({ event: 'created', processId: target.processId, port: target.port });
            },
            onPhase(phase) {
                record({ event: 'phase', phase });
            },
            onRollback(target) {
                record({ event: 'host-rollback', processId: target.processId, port: target.port });
            },
        });
    } catch (error) {
        record({ event: 'startup-failure', error: boundedProbeError(error) });
        startupFailure = { error };
    }
    if (owned && !targetExitObserved(owned)) {
        record({ event: 'normal-close-start', processId: owned.processId, port: owned.port });
        try {
            await host.close(owned);
        } catch (error) {
            record({ event: 'normal-close-failure', processId: owned.processId, error: boundedProbeError(error) });
            if (startupFailure) {
                throw new AggregateError([startupFailure.error, error], 'Startup and normal cleanup failed.');
            }
            throw error;
        }
    }
    if (owned) {
        record({ event: 'cleanup', processId: owned.processId, actualExitObserved: targetExitObserved(owned) });
    }
    if (startupFailure) throw startupFailure.error;
    if (!result) throw new Error('The probe has no verified target result.');
    return result;
}
