import { buildServerArguments } from '../../adapters/official-server.ts';
import type { loadOfficialToolCatalog } from '../../adapters/tool-catalog.ts';
import { type ConnectionStatus, connectionSummary, type GatewayStatus } from '../../domains/control-contract.ts';
import type { createGatewayRegistry } from '../registry.ts';
import type { ManagedConnection } from './managed-connection.ts';

export function createConnectionView({
    registry,
    readCatalog,
}: {
    registry: Pick<
        ReturnType<typeof createGatewayRegistry>,
        'selected' | 'connectionReferences' | 'registrationPrincipal'
    >;
    readCatalog: () => Awaited<ReturnType<typeof loadOfficialToolCatalog>> | undefined;
}) {
    const { selected } = registry;
    function statusOf(connection: ManagedConnection): ConnectionStatus {
        const state = connection.controller.status();
        const upstreamStatus = connection.quarantined
            ? 'quarantined'
            : connection.upstream
              ? 'connected'
              : 'disconnected';
        const enabledTools =
            upstreamStatus === 'connected' ? (connection.upstream?.tools.map((tool) => tool.name) ?? []) : [];
        return {
            ...state,
            connectionId: connection.connectionId,
            upstreamStatus,
            enabledToolCount: enabledTools.length,
            enabledTools,
        };
    }
    function summary(connection: ManagedConnection) {
        return connectionSummary(statusOf(connection));
    }
    function status(): GatewayStatus;
    function status(connectionId: string): ConnectionStatus;
    function status(connectionId?: string): GatewayStatus | ConnectionStatus {
        if (connectionId !== undefined) return statusOf(selected(connectionId));
        return { connections: [...registry.connectionReferences()].filter((item) => !item.owner.retired).map(summary) };
    }
    function projectControlResult(
        request: import('../../domains/control-contract.ts').ControlRequest,
        result: Record<string, unknown>,
    ): Record<string, unknown> {
        if (request.action !== 'status' || request.operationId) return result;
        const fullCatalog = readCatalog();
        if (!fullCatalog) return result;
        const connection = request.connectionId ? selected(request.connectionId) : undefined;
        if (!connection)
            return {
                ...result,
                ...(request.toolNames
                    ? {
                          toolAvailability: fullCatalog.describe(
                              buildServerArguments('http://127.0.0.1:1').slice(1),
                              undefined,
                              request.toolNames,
                          ),
                      }
                    : {}),
            };
        return {
            ...connectionSummary(statusOf(connection)),
            ...(request.toolNames ? {} : { enabledTools: statusOf(connection).enabledTools ?? [] }),
            ...(request.toolNames
                ? {
                      ...(connection.upstream?.toolCatalog ? { toolCatalog: connection.upstream.toolCatalog } : {}),
                      toolAvailability: fullCatalog.describe(
                          connection.mcpArgs,
                          !connection.quarantined ? connection.upstream?.tools : undefined,
                          request.toolNames,
                      ),
                  }
                : {}),
            ...(request.include?.includes('configuration')
                ? {
                      mcpArgs: [...connection.mcpArgs],
                      workspace: structuredClone(connection.workspace),
                      roots: structuredClone(connection.roots),
                      launch: connection.controller.configuration(),
                      official: {
                          generation: connection.officialOwner.sessionId,
                          processId: connection.upstream?.processId,
                          ...(connection.upstream?.toolCatalog ? { toolCatalog: connection.upstream.toolCatalog } : {}),
                      },
                      isolation: connection.directory.evidence(),
                  }
                : {}),
            ...(request.include?.includes('diagnostics') ? { diagnostics: [...connection.diagnostics] } : {}),
        };
    }
    function connections() {
        return [...registry.connectionReferences()].map((connection) => ({
            ...summary(connection),
            registrationId: registry.registrationPrincipal(connection.connectionId)?.registrationId,
            establishedAt: connection.establishedAt,
            lastRealOperationAt: connection.lastRealOperationAt,
            targetGeneration: connection.owner.sessionId,
            officialGeneration: connection.officialOwner.sessionId,
        }));
    }
    return { statusOf, summary, status, projectControlResult, connections };
}
