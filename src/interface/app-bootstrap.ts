import { app, protocol } from 'electron';
import { createAppChromiumStorage } from '../adapters/app-chromium-storage.ts';
import { supportsWindowsApp } from '../domains/app-distribution.ts';

// Refuse unsupported hosts before acquiring paths, scratch storage or main resources.
if (!supportsWindowsApp(process.platform, process.arch)) {
    process.stderr.write('The App supports Windows x64 and arm64 only.\n');
    app.quit();
} else {
    // Keep supported startup synchronous until Chromium's persistent paths are redirected.
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
}
