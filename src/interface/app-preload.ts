import { contextBridge, ipcRenderer } from 'electron';
import { APP_MANAGEMENT_CHANNEL, type AppUiBridge, parseAppUiRequest, parseAppUiSnapshot } from '../domains/app-ui.ts';

async function inspectRequest(request: unknown) {
    const value: unknown = await ipcRenderer.invoke(APP_MANAGEMENT_CHANNEL, parseAppUiRequest(request));
    return parseAppUiSnapshot(value);
}

async function exitRequest(action: 'quit' | 'restart') {
    const value: unknown = await ipcRenderer.invoke(APP_MANAGEMENT_CHANNEL, { action });
    if (value !== undefined) throw new Error('Invalid App exit response.');
}

const bridge: AppUiBridge = Object.freeze({
    inspect: () => inspectRequest({ action: 'inspect' }),
    configure: (configuration) => inspectRequest({ action: 'configure', configuration }),
    manage: (command) => inspectRequest({ action: 'manage', command }),
    quit: () => exitRequest('quit'),
    restart: () => exitRequest('restart'),
});

contextBridge.exposeInMainWorld('dctApp', bridge);
