import { createCdpRouter } from '../adapters/cdp-router.mjs';
import { createControlServer } from '../adapters/control-ipc.mjs';
import { startOfficialServer } from '../adapters/official-server.mjs';
import { createTargetHost } from '../adapters/target-host.mjs';
import { createTargetController } from './target-controller.mjs';

export async function startPluginRuntime({
    createRouter = createCdpRouter,
    createHost = createTargetHost,
    createControl = createControlServer,
    startServer = startOfficialServer,
} = {}) {
    const router = await createRouter();
    const controller = createTargetController({ router, host: createHost() });
    let control;
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
                await control.close();
                await router.close();
            }
        }
        const closed = new Promise((resolve) => child.once('exit', resolve)).then(cleanup);
        return { child, closed, close: cleanup };
    } catch (error) {
        const retained = await controller.cleanupOnDisconnect();
        if (retained) error.details = { retainedTarget: retained };
        await control?.close();
        await router.close();
        throw error;
    }
}
