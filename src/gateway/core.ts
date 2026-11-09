import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/client';
import { createCdpRouter } from '../adapters/cdp-router.ts';
import { profileAvailable as nativeProfileAvailable } from '../adapters/chrome-profile.ts';
import { DataDirectoryRegistry } from '../adapters/data-directory.ts';
import { createOfficialConnection } from '../adapters/mcp-bridge.ts';
import { loadOfficialToolCatalog } from '../adapters/tool-catalog.ts';
import { createClientContext } from '../application/client-context.ts';
import { createRegistrationRegistry } from '../application/registrations.ts';
import type { CoreControlHandler, CoreControlRequest, Diagnose } from '../domains/control-contract.ts';
import type { ClientRequestContext } from '../shared/client-context.ts';
import { DetailedError, errorMessage } from '../shared/errors.ts';
import { createManagedConnections, type RuntimeRouter } from './connections/managed-connection.ts';
import { createGatewayRegistry } from './registry.ts';
import type { TargetLifecycleHost } from './targets/target-lifecycle.ts';

export type GatewayDependencies = {
    onCleanupReady?: (capability: GatewayConstructionCleanup) => void;
    officialRuntime?: Readonly<{ nodeExecutable: string; bin: string }>;
    dataDirectories?: DataDirectoryRegistry;
    profileAvailable?: typeof nativeProfileAvailable;
    createRouter?: (options?: { diagnose?: Diagnose }) => Promise<RuntimeRouter>;
    createHost?: () => TargetLifecycleHost;
    createConnection?: typeof createOfficialConnection;
    loadCatalog?: typeof loadOfficialToolCatalog;
    now?: () => number;
};
export type GatewayConstructionCleanup = Readonly<{
    cleanup(): Promise<void>;
    state(): 'open' | 'closing' | 'failed' | 'closed';
}>;
export async function createGatewayCore({
    dataDirectories = new DataDirectoryRegistry(),
    profileAvailable = nativeProfileAvailable,
    createRouter = createCdpRouter,
    createHost,
    createConnection = createOfficialConnection,
    loadCatalog = loadOfficialToolCatalog,
    now,
    officialRuntime,
    onCleanupReady,
}: GatewayDependencies = {}) {
    const runtimeLocation = officialRuntime ? Object.freeze({ ...officialRuntime }) : undefined;
    const timestamp = now ?? Date.now;
    const entryId = randomUUID();
    const registrations = createRegistrationRegistry({
        ...(now ? { now } : {}),
        onExpire: (principal) => managed.lifecycle.forgetOwner(principal.registrationId),
    });
    const registry = createGatewayRegistry({ entryId, registrations });
    const { newOwner, disposeResources } = registry;
    const managed = createManagedConnections({
        entryId,
        timestamp,
        runtimeLocation,
        dataDirectories,
        profileAvailable,
        createRouter,
        createHost,
        createConnection,
        registrations,
        registry,
        readCatalog: () => fullCatalog,
    });
    let fullCatalog: Awaited<ReturnType<typeof loadOfficialToolCatalog>> | undefined;
    const catalogOwner = newOwner(randomUUID());
    function cleanup() {
        return registry.cleanup(managed.lifecycle);
    }
    // Trusted composition retains this capability even if construction later rejects.
    // A throwing callback runs before the first resource acquisition.
    onCleanupReady?.(Object.freeze({ cleanup, state: () => registry.cleanupState }));
    try {
        catalogOwner.assertOpen();
        const catalogRouter = await catalogOwner.track(
            createRouter().then((router) => {
                catalogOwner.register('router', router);
                catalogOwner.assertOpen();
                return router;
            }),
        );
        const catalogConnection = await catalogOwner.track(
            createConnection(catalogRouter.url, {
                ...runtimeLocation,
                signal: catalogOwner.signal,
                onAcquired: (resource) => catalogOwner.register('upstream', resource),
            }).then((connection) => {
                if (!catalogOwner.hasResource('upstream')) catalogOwner.register('upstream', connection);
                catalogOwner.assertOpen();
                return connection;
            }),
        );
        fullCatalog = await loadCatalog(catalogConnection.tools);
        catalogOwner.assertOpen();
        fullCatalog.validate(catalogConnection.tools);
        const catalog: Tool[] = fullCatalog.tools;
        await disposeResources(catalogOwner);
        catalogOwner.retire(new Error('Catalog discovery completed.'));
        registry.forgetCatalogOwner(catalogOwner);
        return {
            entryId,
            controller: managed.handler as CoreControlHandler,
            tools: catalog,
            invoke: (name: string, args: Record<string, unknown>, client: ClientRequestContext) =>
                managed.invoke(name, args, client.waitSignal, client.progress, client),
            cleanup,
            register() {
                if (registry.closing) throw new Error('The gateway is closing.');
                return registrations.create();
            },
            control: (request: CoreControlRequest, client: ClientRequestContext) =>
                managed.control(request, client.waitSignal, client),
            attachClient(bearer: string) {
                return createClientContext(registrations.authenticate(bearer));
            },
            admin: {
                registrations: registrations.list,
                unregister: (registrationId: string) => registrations.unregister(registrations.resolve(registrationId)),
                transfer: managed.transfer,
                status: managed.status,
                connections: managed.connections,
                operations: managed.lifecycle.list,
                control: managed.adminControl,
                cleanupState: () => registry.cleanupState,
            },
        };
    } catch (error) {
        try {
            await cleanup();
        } catch (cleanupError) {
            const failure = new DetailedError(errorMessage(error), { cause: error });
            failure.details = { cleanupError: errorMessage(cleanupError) };
            throw failure;
        }
        throw error;
    }
}

export type GatewayCore = Awaited<ReturnType<typeof createGatewayCore>>;
