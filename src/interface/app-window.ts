import path from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { readRegularFile } from '../adapters/file-evidence.ts';
import type { AppConfiguration } from '../domains/app-configuration.ts';
import {
    APP_MANAGEMENT_CHANNEL,
    APP_UI_URL,
    type AppManagementCommand,
    type AppUiSnapshot,
    appAssetPath,
    parseAppUiRequest,
    parseAppUiSnapshot,
} from '../domains/app-ui.ts';

const CONTENT_SECURITY_POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";

export async function createManagementWindow(options: {
    directory: string;
    inspect: () => AppUiSnapshot;
    configure: (configuration: AppConfiguration) => Promise<AppUiSnapshot>;
    manage: (command: AppManagementCommand) => Promise<AppUiSnapshot>;
    quit: () => Promise<void>;
    restart: () => Promise<void>;
    canDestroy: () => boolean;
    onShutdownFailure: () => void;
}) {
    const assets = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
    for (const [url, filename, contentType] of [
        ['/', 'app.html', 'text/html; charset=utf-8'],
        ['/app-renderer.js', 'app-renderer.js', 'text/javascript; charset=utf-8'],
        ['/app.css', 'app.css', 'text/css; charset=utf-8'],
        ['/icon.png', 'icon.png', 'image/png'],
    ]) {
        if (!url || !filename || !contentType) throw new Error('Invalid fixed App asset inventory.');
        assets.set(url, {
            bytes: new Uint8Array(await readRegularFile(path.join(options.directory, filename))),
            contentType,
        });
    }
    const window = new BrowserWindow({
        width: 1040,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        show: false,
        backgroundColor: '#f4f1e9',
        title: 'Debugging CDP Targets',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(options.directory, 'app-preload.cjs'),
            partition: 'dct-app-manager',
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
            spellcheck: false,
            devTools: false,
        },
    });
    window.setMenu(null);
    const contents = window.webContents;
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
    await contents.session.protocol.handle('dct-app', (request) => {
        const selected = appAssetPath(request.url, request.method, Reflect.get(request, 'initiatorOrigin'));
        const asset = selected === undefined ? undefined : assets.get(selected);
        if (!asset) return new Response('Unavailable.', { status: 404 });
        return new Response(asset.bytes, {
            headers: {
                'Content-Type': asset.contentType,
                'Content-Security-Policy': CONTENT_SECURITY_POLICY,
                'X-Content-Type-Options': 'nosniff',
            },
        });
    });
    ipcMain.handle(APP_MANAGEMENT_CHANNEL, async (event, ...values: unknown[]) => {
        if (
            event.sender !== contents ||
            event.senderFrame !== contents.mainFrame ||
            event.senderFrame.url !== APP_UI_URL ||
            values.length !== 1
        )
            throw new Error('Management request rejected.');
        const request = parseAppUiRequest(values[0]);
        switch (request.action) {
            case 'inspect':
                return parseAppUiSnapshot(options.inspect());
            case 'configure':
                return parseAppUiSnapshot(await options.configure(request.configuration));
            case 'manage':
                return parseAppUiSnapshot(await options.manage(request.command));
            case 'quit':
                return options.quit();
            case 'restart':
                return options.restart();
        }
    });
    window.on('close', (event) => {
        if (options.canDestroy()) return;
        event.preventDefault();
        void options.quit().catch(() => options.onShutdownFailure());
    });
    window.on('closed', () => ipcMain.removeHandler(APP_MANAGEMENT_CHANNEL));
    try {
        await window.loadURL(APP_UI_URL);
    } catch (error) {
        ipcMain.removeHandler(APP_MANAGEMENT_CHANNEL);
        window.destroy();
        throw error;
    }
    return {
        window,
        activate() {
            if (window.isDestroyed()) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
        },
    };
}
