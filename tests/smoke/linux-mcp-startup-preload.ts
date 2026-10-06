import childProcess from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    boundedDiagnosticError,
    captureChromeSpawn,
    createChromeOutputFiles,
    createDiagnosticWriter,
    injectGatewayPreload,
    observeOwnedFetch,
    preloadRole,
} from './linux-mcp-startup-support.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const gateway = path.join(root, 'plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs');
const role = preloadRole(process.argv[1], {
    gateway,
    smokes: [path.join(root, 'tests/smoke/official-server.ts'), path.join(root, 'tests/smoke/entry-recovery.ts')],
});
if (process.platform === 'linux' && role !== 'inactive') {
    let setupRecord: ReturnType<typeof createDiagnosticWriter> | undefined;
    try {
        const preload = new URL(import.meta.url);
        const requested = preload.searchParams.get('directory');
        if (!requested || !path.isAbsolute(requested))
            throw new Error('The probe requires its owned absolute log directory.');
        const directory = role === 'parent' ? mkdtempSync(path.join(requested, 'smoke-')) : requested;
        const record = createDiagnosticWriter(path.join(directory, `${role}-${process.pid}.events.jsonl`));
        setupRecord = record;
        record({
            event: 'preload-active',
            role,
            processId: process.pid,
            parentProcessId: process.ppid,
            nodeVersion: process.version,
            osRelease: os.release(),
            display: process.env.DISPLAY ?? null,
            xauthority: process.env.XAUTHORITY ?? null,
        });
        if (role === 'parent') {
            preload.searchParams.set('directory', directory);
            childProcess.spawn = injectGatewayPreload(childProcess.spawn, process.execPath, gateway, preload.href);
        } else {
            const chrome = process.env.DCT_SMOKE_CHROME_EXECUTABLE;
            if (!chrome || !path.isAbsolute(chrome)) throw new Error('The probe requires explicitly selected Chrome.');
            const ownedPorts = new Set<number>();
            childProcess.spawn = captureChromeSpawn(childProcess.spawn, chrome, {
                ...createChromeOutputFiles(directory),
                ownedPorts,
                record,
            });
            globalThis.fetch = observeOwnedFetch(globalThis.fetch, ownedPorts, record);
        }
        syncBuiltinESMExports();
    } catch (error) {
        setupRecord?.({ event: 'preload-setup-error', error: boundedDiagnosticError(error) });
    }
}
