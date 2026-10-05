import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createCdpRouter } from '../../src/adapters/cdp-router.ts';
import { createOfficialConnection } from '../../src/adapters/mcp-bridge.ts';
import { buildServerArguments } from '../../src/adapters/official-server.ts';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import type { Diagnostic } from '../../src/shared/diagnostics.ts';
import { errorCode } from '../../src/shared/errors.ts';

const folder = path.resolve(process.argv[2] ?? '.superpowers/sdd/mcp-native-lifecycle/screenshot-layers');
await mkdir(folder, { recursive: true });
const host = createTargetHost();
const target = await host.launch({
    targetKind: 'chrome',
    basePort: 20222,
    launch: {
        executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        args: [
            '--no-first-run',
            '--disable-background-networking',
            '--disable-background-mode',
            `--user-data-dir=${path.join(folder, 'profile')}`,
            '--remote-debugging-port={port}',
            'data:text/html,<title>DCT screenshot control</title><h1>Screenshot control</h1>',
        ],
    },
});
const evidence: Record<string, unknown>[] = [];
try {
    for (const mode of ['normal', 'minimized'] as const) {
        const window = await promisify(execFile)(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./windows-window-evidence.ps1', import.meta.url)),
                '-ApplicationPid',
                String(target.processId),
                '-State',
                mode === 'minimized' ? 'Minimize' : 'None',
                '-ExecutablePath',
                target.executablePath,
                '-StartedAtUtc',
                target.startedAtUtc,
            ],
            { windowsHide: true, shell: false },
        );
        const windows: unknown = JSON.parse(window.stdout);
        for (const route of ['direct', 'gateway-router'] as const) {
            const diagnostics: Diagnostic[] = [];
            const router =
                route === 'gateway-router'
                    ? await createCdpRouter({ diagnose: (event) => diagnostics.push(event) })
                    : undefined;
            router?.setTarget(target);
            const started = performance.now();
            const upstream = await createOfficialConnection(router?.url ?? `http://127.0.0.1:${target.port}`, {
                args: buildServerArguments(router?.url ?? `http://127.0.0.1:${target.port}`, process.env, [
                    '--workspace',
                    folder,
                ]),
            });
            const initializedMs = performance.now() - started;
            try {
                const listing = await upstream.call('list_pages', {});
                const text = listing.content.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n');
                const page = text.match(/^(\d+):.*DCT screenshot control/m);
                assert.ok(page?.[1], 'Isolated control page missing');
                const screenshotStart = performance.now();
                const result = await upstream.call('take_screenshot', {
                    pageId: Number(page[1]),
                    filePath: path.join(folder, `${mode}-${route}.png`),
                });
                evidence.push({
                    route,
                    mode,
                    processId: target.processId,
                    initializedMs,
                    screenshotMs: performance.now() - screenshotStart,
                    success: result.isError !== true,
                    diagnostics,
                    windows,
                });
                assert.notEqual(result.isError, true);
            } catch (error) {
                evidence.push({
                    route,
                    mode,
                    outcome: 'failed',
                    category: errorCode(error) ?? 'upstream-error',
                    diagnostics,
                });
                throw error;
            } finally {
                router?.clearTarget();
                await upstream.close();
                await router?.close();
                await writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify(evidence, null, 4)}\n`);
            }
        }
    }
} finally {
    assert.equal(await host.close(target, { requireListener: false }), true, 'Test browser normal close failed');
}
console.log(
    JSON.stringify({
        folder,
        comparisons: evidence.map(({ windows, diagnostics, ...summary }) => ({ ...summary, diagnostics })),
    }),
);
