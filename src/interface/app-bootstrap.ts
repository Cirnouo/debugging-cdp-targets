import { app, protocol } from 'electron';
import { createAppChromiumStorage } from '../adapters/app-chromium-storage.ts';

// Keep this entry synchronous until Chromium's default persistent paths are redirected.
const appData = app.getPath('appData');
const chromium = createAppChromiumStorage();
app.setPath('userData', chromium.userData);
app.setPath('sessionData', chromium.sessionData);
protocol.registerSchemesAsPrivileged([
    { scheme: 'dct-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const { startDesktopApp } = await import('./app-main.ts');
await startDesktopApp({ appData, chromium });
