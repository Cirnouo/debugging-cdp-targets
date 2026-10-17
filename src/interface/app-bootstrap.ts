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

// Electron releases ready only after this entry import settles. Main retains the
// startup promise and cleanup ownership; awaiting it here would block ready.
void import('./app-main.ts')
    .then(({ startDesktopApp }) => startDesktopApp({ appData, chromium }))
    .catch(() => {
        // Main's early normal-Quit handler remains responsible for acquired resources.
        process.stderr.write('App startup could not complete. Use normal Quit to retry owned cleanup.\n');
    });
