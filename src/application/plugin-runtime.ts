import { createCdpRouter } from '../adapters/cdp-router.ts';
import { createControlServer } from '../adapters/control-ipc.ts';
import { startOfficialServer } from '../adapters/official-server.ts';
import { createTargetHost } from '../adapters/target-host.ts';
import type { ControlHandler } from '../domains/control-contract.ts';
import type { ControllerHost, ControllerRouter } from './target-controller.ts';
import { createTargetController } from './target-controller.ts';

type RuntimeRouter = ControllerRouter & { url: string; close(): Promise<void> };
type RuntimeDependencies = {
    createRouter?: () => Promise<RuntimeRouter>;
    createHost?: () => ControllerHost;
    createControl?: (options: { controller: ControlHandler }) => Promise<{ close(): Promise<void> }>;
    startServer?: (url: string) => Promise<{ once(event: 'exit', listener: () => void): unknown }>;
};

export async function startPluginRuntime({
    createRouter = createCdpRouter,
    createHost = createTargetHost,
    createControl = createControlServer,
    startServer = startOfficialServer,
}: RuntimeDependencies = {}) {
    const router = await createRouter();
    const controller = createTargetController({ router, host: createHost() });
    let control: { close(): Promise<void> } | undefined;
    try {
        control = await createControl({ controller });
        const child = await startServer(router.url);
        let cleaned = false;
        async function cleanup() {
            if (cleaned) return;
            cleaned = true;
            try {
                const retained = await controller.cleanupOnDisconnect();
                if (retained)
                    process.stderr.write(
                        `Target did not close normally; inspect PID ${retained.processId}, port ${retained.port}.\n`,
                    );
            } finally {
                await control?.close();
                await router.close();
            }
        }
        const closed = new Promise<void>((resolve) => child.once('exit', resolve)).then(cleanup);
        return { child, closed, close: cleanup };
    } catch (error) {
        const retained = await controller.cleanupOnDisconnect();
        if (retained && error instanceof Error) Object.assign(error, { details: { retainedTarget: retained } });
        await control?.close();
        await router.close();
        throw error;
    }
}
