import { randomUUID } from 'node:crypto';
import {
    APP_OPERATION_FAILURE_VALUES,
    type AppHostSummary,
    type AppManagementCommand,
    type AppManagementSnapshot,
    parseAppManagementCommand,
    parseAppManagementSnapshot,
} from '../domains/app-ui.ts';
import type { ConnectionRoute } from '../domains/control-contract.ts';
import { isRecord } from '../shared/errors.ts';
import type { GatewayCore } from './plugin-runtime.ts';

/** Trusted in-process administration. Only closed, secret-free projections cross preload. */
export function createAppManagement(options: {
    core: () => GatewayCore | undefined;
    closing: () => boolean;
    hosts: {
        snapshot(): AppHostSummary[];
        run(command: Extract<AppManagementCommand, { host: string }>): Promise<void>;
    };
}) {
    function snapshot(): AppManagementSnapshot {
        const admin = options.core()?.admin;
        const connections = (admin?.connections() ?? []).map((item) => ({
            connectionId: item.connectionId,
            ...(item.sessionId === undefined ? {} : { sessionId: item.sessionId }),
            status: item.status,
            targetGeneration: item.targetGeneration,
            officialGeneration: item.officialGeneration,
            ...(item.registrationId === undefined ? {} : { registrationId: item.registrationId }),
            ...(item.upstreamStatus === undefined ? {} : { upstreamStatus: item.upstreamStatus }),
            ...(item.establishedAt === undefined ? {} : { establishedAt: item.establishedAt }),
            ...(item.lastRealOperationAt === undefined ? {} : { lastRealOperationAt: item.lastRealOperationAt }),
            ...(item.processId === undefined ? {} : { processId: item.processId }),
            ...(item.port === undefined ? {} : { port: item.port }),
        }));
        const operations = (admin?.operations() ?? []).map((item) => ({
            operationId: item.operationId,
            requestId: item.requestId,
            state: item.state,
            phase: item.phase,
            elapsedMs: Math.floor(item.elapsedMs),
            cursor: item.cursor,
            ...(item.registrationId === undefined ? {} : { registrationId: item.registrationId }),
            ...(item.connectionId === undefined ? {} : { connectionId: item.connectionId }),
            ...(item.sessionId === undefined ? {} : { sessionId: item.sessionId }),
            ...(item.action === undefined ? {} : { action: item.action }),
        }));
        return parseAppManagementSnapshot({
            registrations: admin?.registrations() ?? [],
            connections,
            operations,
            hosts: options.hosts.snapshot(),
        });
    }
    function current(route: ConnectionRoute) {
        const connection = snapshot().connections.find((item) => item.connectionId === route.connectionId);
        if (!connection || connection.sessionId !== route.sessionId)
            throw new Error('The selected connection is absent or stale.');
    }
    async function manage(input: AppManagementCommand): Promise<AppManagementSnapshot> {
        const command = parseAppManagementCommand(input);
        const reading =
            command.kind === 'connection' || command.kind === 'operation-status' || command.kind === 'operation-wait';
        if (options.closing() && !reading)
            throw new Error('The App is closing and retains ownership until cleanup succeeds.');
        if (command.kind === 'host-inspect' || command.kind === 'host-sync') {
            await options.hosts.run(command);
            return snapshot();
        }
        const admin = options.core()?.admin;
        if (!admin) throw new Error('The verified gateway is unavailable.');
        if (command.kind === 'restart') {
            current(command.route);
            await admin.control({ action: 'restart', requestId: randomUUID(), ...command.route, scope: command.scope });
        } else if (command.kind === 'close' || command.kind === 'transfer') {
            const outcomes = await Promise.all(
                command.routes.map(async (route) => {
                    try {
                        current(route);
                        if (command.kind === 'transfer') {
                            admin.transfer(route.connectionId, command.registrationId);
                            return { connectionId: route.connectionId, state: 'transferred' as const };
                        }
                        const accepted = await admin.control({
                            action: 'stop',
                            requestId: randomUUID(),
                            ...route,
                            disposition: 'Close',
                        });
                        if (typeof accepted.operationId !== 'string') throw new Error('Missing lifecycle operation.');
                        return {
                            connectionId: route.connectionId,
                            state: 'accepted' as const,
                            operationId: accepted.operationId,
                        };
                    } catch (error) {
                        const reason =
                            error instanceof Error && /busy/i.test(error.message)
                                ? ('busy' as const)
                                : error instanceof Error && /absent|stale/i.test(error.message)
                                  ? ('stale' as const)
                                  : ('rejected' as const);
                        return { connectionId: route.connectionId, state: 'failed' as const, reason };
                    }
                }),
            );
            return parseAppManagementSnapshot({ ...snapshot(), outcomes });
        } else if (command.kind === 'unregister') {
            admin.unregister(command.registrationId);
        } else if (command.kind === 'connection') {
            current(command.route);
            const detail = await admin.control({
                action: 'status',
                connectionId: command.route.connectionId,
                include: ['configuration'],
            });
            current(command.route);
            const strings = (value: unknown) =>
                Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
            const launch = isRecord(detail.launch) ? detail.launch.effectiveLaunch : undefined;
            const portPolicy =
                isRecord(detail.launch) && isRecord(detail.launch.portPolicy)
                    ? detail.launch.portPolicy.kind
                    : undefined;
            return parseAppManagementSnapshot({
                ...snapshot(),
                selected: {
                    ...command.route,
                    enabledTools: strings(detail.enabledTools),
                    mcpArgs: strings(detail.mcpArgs),
                    ...(isRecord(launch)
                        ? {
                              launch: {
                                  executable: launch.executablePath,
                                  arguments: strings(launch.arguments),
                                  ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
                                  environmentNames: isRecord(launch.env) ? Object.keys(launch.env).sort() : [],
                                  ...(portPolicy === undefined ? {} : { portPolicy }),
                              },
                          }
                        : {}),
                    ...(detail.isolation === undefined ? {} : { isolation: detail.isolation }),
                },
            });
        } else {
            const result = await admin.control({
                action:
                    command.kind === 'operation-cancel'
                        ? 'cancel'
                        : command.kind === 'operation-wait'
                          ? 'wait'
                          : 'status',
                operationId: command.operationId,
                ...(command.kind === 'operation-wait' ? { cursor: command.cursor } : {}),
            });
            if (!isRecord(result)) throw new Error('Invalid lifecycle result.');
            const operation = command.kind === 'operation-wait' ? result.operation : result;
            if (!isRecord(operation) || operation.operationId !== command.operationId)
                throw new Error('Invalid selected lifecycle operation.');
            const state = snapshot();
            const summary = state.operations.find((item) => item.operationId === command.operationId);
            if (!summary) throw new Error('The selected operation is no longer available.');
            const projectedResult = isRecord(operation.result)
                ? Object.fromEntries(
                      Object.entries(operation.result).filter(([key]) =>
                          [
                              'connectionId',
                              'sessionId',
                              'status',
                              'disposition',
                              'upstreamStatus',
                              'processId',
                              'port',
                              'enabledToolCount',
                              'pageIdsInvalidated',
                          ].includes(key),
                      ),
                  )
                : undefined;
            const error = isRecord(operation.error) ? operation.error : undefined;
            const projectedError = error
                ? {
                      kind:
                          summary.action === 'stop'
                              ? 'close-failed'
                              : summary.action === 'start'
                                ? 'start-failed'
                                : summary.action === 'restart'
                                  ? 'restart-failed'
                                  : 'operation-failed',
                      ...Object.fromEntries(
                          Object.entries(error).filter(([key, value]) => {
                              if (key === 'phase' || key === 'category' || key === 'code')
                                  return (
                                      typeof value === 'string' &&
                                      (APP_OPERATION_FAILURE_VALUES[key] as readonly string[]).includes(value)
                                  );
                              if (key === 'nativeError') return Number.isSafeInteger(value);
                              if (key === 'listenerState')
                                  return value === 'owned' || value === 'foreign' || value === 'absent';
                              return (
                                  [
                                      'closeRequested',
                                      'processExited',
                                      'closeConfirmed',
                                      'catalogUpstreamRetained',
                                  ].includes(key) && typeof value === 'boolean'
                              );
                          }),
                      ),
                  }
                : undefined;
            return parseAppManagementSnapshot({
                ...state,
                selectedOperation: {
                    // The registry owner is immutable; current connection ownership is unrelated.
                    operationId: operation.operationId,
                    requestId: operation.requestId,
                    ...(summary.registrationId === undefined ? {} : { registrationId: summary.registrationId }),
                    ...(operation.action === undefined ? {} : { action: operation.action }),
                    ...(operation.connectionId === undefined ? {} : { connectionId: operation.connectionId }),
                    ...(operation.sessionId === undefined ? {} : { sessionId: operation.sessionId }),
                    state: operation.state,
                    phase: operation.phase,
                    elapsedMs: typeof operation.elapsedMs === 'number' ? Math.floor(operation.elapsedMs) : undefined,
                    cursor: operation.cursor,
                    ...(projectedResult === undefined ? {} : { result: projectedResult }),
                    ...(projectedError === undefined ? {} : { error: projectedError }),
                    ...(operation.isolation === undefined ? {} : { isolation: operation.isolation }),
                    ...(command.kind === 'operation-wait'
                        ? {
                              wait: {
                                  cursor: result.cursor,
                                  complete: result.complete,
                                  replayTruncated: result.replayTruncated,
                              },
                          }
                        : {}),
                },
            });
        }
        return snapshot();
    }
    return { snapshot, manage };
}
