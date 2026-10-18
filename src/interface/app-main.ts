import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, Menu, nativeImage, Tray } from 'electron';
import { activateExistingApp, listenForAppActivation } from '../adapters/app-activation.ts';
import type { createAppChromiumStorage } from '../adapters/app-chromium-storage.ts';
import { openAppConfiguration } from '../adapters/app-configuration.ts';
import { loadAppAdvisoryLock } from '../adapters/app-native.ts';
import { verifyAppOfficialRuntime } from '../adapters/app-official-runtime.ts';
import { acquireAppSingleton } from '../adapters/app-singleton.ts';
import { prepareAppDataDirectory, selectAppDataDirectory } from '../adapters/app-storage.ts';
import { readRegularFile } from '../adapters/file-evidence.ts';
import { createMcpHttpServer } from '../adapters/mcp-http-server.ts';
import { createAppHostManagement } from '../application/app-host-management.ts';
import { createAppManagement } from '../application/app-management.ts';
import { createGatewayCore, type GatewayConstructionCleanup, type GatewayCore } from '../application/plugin-runtime.ts';
import type { AppConfiguration } from '../domains/app-configuration.ts';
import { parseAppDistribution } from '../domains/app-distribution.ts';
import { parseAppNativeEvidence } from '../domains/app-release.ts';
import type { AppUiSnapshot } from '../domains/app-ui.ts';
import { createManagementWindow } from './app-window.ts';

declare const __DCT_APP_VERSION__: string;

export async function startDesktopApp(options: {
    appData: string;
    chromium: ReturnType<typeof createAppChromiumStorage>;
}) {
    // Module-relative paths stay pinned to this complete build throughout its process lifetime.
    const directory = path.dirname(fileURLToPath(import.meta.url));
    let configuration: Awaited<ReturnType<typeof openAppConfiguration>> | undefined;
    let core: GatewayCore | undefined;
    let construction: GatewayConstructionCleanup | undefined;
    let startup: Promise<void> | undefined;
    let http: Awaited<ReturnType<typeof createMcpHttpServer>> | undefined;
    let activation: Awaited<ReturnType<typeof listenForAppActivation>> | undefined;
    let manager: Awaited<ReturnType<typeof createManagementWindow>> | undefined;
    let tray: Tray | undefined;
    let phase: AppUiSnapshot['phase'] = 'starting';
    let message: string | undefined;
    let allowExit = false;
    let requestedActivation = false;
    let shutdown: Promise<void> | undefined;
    let hosts: ReturnType<typeof createAppHostManagement> | undefined;
    let savingConfiguration = false;
    let configurationWrite: Promise<void> | undefined;
    let exitIntent: 'quit' | 'restart' = 'quit';
    const isClosing = () => phase === 'closing';
    const management = createAppManagement({
        core: () => core,
        closing: isClosing,
        hosts: {
            snapshot: () => hosts?.snapshot() ?? [],
            run: async (command) => {
                if (savingConfiguration) throw new Error('Settings are being saved.');
                if (!hosts) throw new Error('Host management is unavailable.');
                await hosts.run(command);
            },
        },
    });
    const inspect = (): AppUiSnapshot => ({
        phase,
        ...(configuration ? { configuration: configuration.state() } : {}),
        ...(message ? { message } : {}),
        management: management.snapshot(),
        ...(phase === 'closing' ? { exitIntent } : {}),
    });
    async function configure(value: AppConfiguration) {
        if (!configuration) throw new Error('Configuration is unavailable.');
        if (phase === 'starting') throw new Error('Settings are unavailable during startup.');
        if (isClosing() || savingConfiguration) throw new Error('The App is closing or settings are being saved.');
        savingConfiguration = true;
        try {
            hosts?.assertConfigurable(value.hosts);
            configurationWrite = configuration.save(value);
            await configurationWrite;
            hosts?.configure(configuration.state().desired.hosts);
            return inspect();
        } finally {
            savingConfiguration = false;
            configurationWrite = undefined;
        }
    }
    async function manage(command: Parameters<typeof management.manage>[0]) {
        if (savingConfiguration) throw new Error('Settings are being saved.');
        const result = await management.manage(command);
        return { ...inspect(), management: result };
    }
    const activate = () => {
        requestedActivation = true;
        manager?.activate();
    };
    const refresh = () => {
        if (manager && !manager.window.isDestroyed()) manager.window.webContents.reload();
    };
    function quit(restart = false): Promise<void> {
        if (shutdown) return shutdown;
        exitIntent = restart ? 'restart' : 'quit';
        phase = 'closing';
        message = 'Waiting for normal owned target, official Server and router cleanup.';
        const pending = (async () => {
            try {
                await startup?.catch(() => {});
                await configurationWrite?.catch(() => {});
                const cleanup = await Promise.allSettled([construction?.cleanup(), hosts?.close()]);
                const failed = cleanup.find((result) => result.status === 'rejected');
                if (failed?.status === 'rejected') throw failed.reason;
                await http?.close();
                await activation?.close();
                tray?.destroy();
                allowExit = true;
                manager?.window.destroy();
                await options.chromium.cleanup();
                if (restart) app.relaunch();
                app.quit();
            } catch (error) {
                phase = 'closing';
                message = `Normal cleanup failed. The App retains ownership. Retry ${restart ? 'Restart' : 'Quit'}.`;
                activate();
                refresh();
                throw error;
            }
        })();
        shutdown = pending;
        void pending
            .finally(() => {
                if (!allowExit) shutdown = undefined;
            })
            .catch(() => {});
        return pending;
    }
    app.on('before-quit', (event) => {
        if (!allowExit) {
            event.preventDefault();
            void quit().catch(() => {});
        }
    });
    app.on('window-all-closed', () => {});
    app.on('activate', activate);
    app.on('will-quit', () => {
        void options.chromium.cleanup();
    });
    async function initialize() {
        try {
            const nativeEvidence = parseAppNativeEvidence(
                JSON.parse(
                    (await readRegularFile(path.join(directory, 'delivery/app-native-release.json'))).toString('utf8'),
                ),
            );
            const tryLock = await loadAppAdvisoryLock(nativeEvidence);
            if (isClosing()) return;
            const admission = acquireAppSingleton({ tryLock });
            if (!admission.ownsSingleton) {
                const activated = await activateExistingApp(admission.paths.activation);
                if (!activated) {
                    await app.whenReady();
                    await dialog.showMessageBox({
                        type: 'warning',
                        title: 'Debugging CDP Targets is already running',
                        message: 'The App is already running, but its manager could not be activated.',
                        detail: 'The existing App keeps ownership. Open its manager from the tray or Dock, or quit that instance normally before trying again.',
                        buttons: ['OK'],
                        noLink: true,
                    });
                }
                allowExit = true;
                await options.chromium.cleanup();
                app.quit();
                return;
            }
            activation = await listenForAppActivation({
                ownsSingleton: true,
                endpoint: admission.paths.activation,
                activate,
            });
            const distribution = parseAppDistribution(
                JSON.parse((await readRegularFile(path.join(directory, 'distribution.json'))).toString('utf8')),
                { platform: process.platform, architecture: process.arch },
            );
            const selected =
                distribution.kind === 'portable'
                    ? selectAppDataDirectory({
                          kind: 'portable',
                          executablePath: process.execPath,
                          platform: process.platform,
                      })
                    : selectAppDataDirectory({
                          kind: 'installed',
                          userDataDirectory: path.join(options.appData, 'debugging-cdp-targets'),
                      });
            const dataRoot = await prepareAppDataDirectory(selected, admission);
            configuration = await openAppConfiguration(dataRoot, admission);
            hosts = createAppHostManagement({
                dataRoot,
                appVersion: typeof __DCT_APP_VERSION__ === 'undefined' ? '0.1.0' : __DCT_APP_VERSION__,
                hosts: configuration.state().effective.hosts,
                endpoint: () =>
                    phase === 'ready' && http && configuration
                        ? `http://127.0.0.1:${configuration.state().effective.port}/mcp`
                        : undefined,
            });
            await app.whenReady();
            if (isClosing()) return;
            manager = await createManagementWindow({
                directory,
                inspect,
                configure,
                manage,
                quit,
                restart: () => quit(true),
                canDestroy: () => allowExit,
                onShutdownFailure: activate,
            });
            try {
                const icon = nativeImage.createFromPath(path.join(directory, 'icon.png'));
                if (process.platform === 'darwin') icon.setTemplateImage(true);
                tray = new Tray(icon);
                tray.setToolTip('Debugging CDP Targets');
                tray.setContextMenu(
                    Menu.buildFromTemplate([
                        { label: 'Open manager', click: activate },
                        {
                            label: 'Quit App',
                            click: () => {
                                void quit().catch(() => {});
                            },
                        },
                    ]),
                );
                tray.on('click', activate);
            } catch {
                tray = undefined;
            }
            if (!tray || process.platform === 'linux' || requestedActivation) activate();
            const officialRuntime = await verifyAppOfficialRuntime({
                directory,
                resources: process.resourcesPath,
                platform: process.platform,
                architecture: process.arch,
            });
            if (isClosing()) return;
            core = await createGatewayCore({
                officialRuntime,
                onCleanupReady: (value) => {
                    construction = value;
                },
            });
            if (isClosing()) return;
            if (!configuration) throw new Error('Configuration is unavailable.');
            http = await createMcpHttpServer({
                port: configuration.state().effective.port,
                core,
                accepting: () => phase === 'ready',
            });
            if (isClosing()) return;
            phase = 'ready';
            // No published candidate exists in 0.1.0. Restore/revalidate owned receipts only after this bind.
            for (const host of ['codex', 'claude'] as const)
                void hosts?.run({ kind: 'host-sync', host }).catch(() => {});
            refresh();
        } catch {
            if (isClosing()) return;
            phase = 'failed';
            message = configuration
                ? 'The App could not start its verified gateway or bind the desired port. Review settings and restart normally.'
                : 'The App could not verify its delivery, acquire ownership or load configuration. Existing data was preserved.';
            await app.whenReady();
            manager ??= await createManagementWindow({
                directory,
                inspect,
                configure,
                manage,
                quit,
                restart: () => quit(true),
                canDestroy: () => allowExit,
                onShutdownFailure: activate,
            });
            refresh();
            activate();
        }
    }
    startup = initialize();
    await startup;
}
