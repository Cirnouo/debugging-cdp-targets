import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { isRecord } from '../src/shared/errors.ts';

// Model Electron's public entry-loader boundary: ready is released only after entry import settles.
// Electron and storage are I/O replacements; the entry under test is the maintained bootstrap.
async function loadBootstrap(failStartup = false) {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-bootstrap-loader-'));
    const stateUrl = pathToFileURL(path.join(directory, 'state.mjs')).href;
    try {
        await writeFile(
            path.join(directory, 'state.mjs'),
            `let release;export const state={events:[],ready:new Promise(resolve=>{release=resolve}),release:()=>release()};`,
        );
        const modules: Record<string, string> = {
            electron: `import{state}from${JSON.stringify(stateUrl)};export const app={getPath:()=>{state.events.push('appData');return'fixture'},setPath:name=>state.events.push(name)};export const protocol={registerSchemesAsPrivileged:()=>state.events.push('protocol')};`,
            '../adapters/app-chromium-storage.ts': `import{state}from${JSON.stringify(stateUrl)};export function createAppChromiumStorage(){state.events.push('storage');return{userData:'fixture-user',sessionData:'fixture-session'}}`,
            './app-main.ts': `import{state}from${JSON.stringify(stateUrl)};export async function startDesktopApp(){state.events.push('startup');await state.ready;${failStartup ? "throw Error('private-startup-detail')" : "state.events.push('startup-ready')"}}`,
        };
        const bundle = await build({
            entryPoints: [path.join(root, 'src/interface/app-bootstrap.ts')],
            bundle: true,
            platform: 'node',
            format: 'esm',
            write: false,
            plugins: [
                {
                    name: 'bootstrap-io',
                    setup(builder) {
                        builder.onResolve({ filter: /.*/ }, (args) =>
                            modules[args.path]
                                ? { path: args.path, namespace: 'bootstrap-io' }
                                : args.path === stateUrl
                                  ? { path: stateUrl, external: true }
                                  : undefined,
                        );
                        builder.onLoad({ filter: /.*/, namespace: 'bootstrap-io' }, (args) => ({
                            contents: modules[args.path] ?? '',
                        }));
                    },
                },
            ],
        });
        const output = bundle.outputFiles[0];
        assert.ok(output);
        await writeFile(path.join(directory, 'entry.mjs'), output.contents);
        await writeFile(
            path.join(directory, 'loader.mjs'),
            `import{state}from'./state.mjs';import{setTimeout as delay}from'node:timers/promises';let settled=false;const unhandled=[];process.on('unhandledRejection',()=>unhandled.push(true));const entry=import('./entry.mjs').then(()=>{settled=true});await delay(100);const entrySettledBeforeReady=settled;state.release();await entry;await delay(10);console.log(JSON.stringify({entrySettledBeforeReady,events:state.events,unhandled}));`,
        );
        const result = await promisify(execFile)(process.execPath, [path.join(directory, 'loader.mjs')], {
            windowsHide: true,
            timeout: 5000,
            env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
        });
        const parsed: unknown = JSON.parse(result.stdout);
        assert.ok(isRecord(parsed));
        return { state: parsed, stderr: result.stderr };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('bootstrap import completes before ready-dependent startup and keeps synchronous Chromium isolation first', async () => {
    const result = await loadBootstrap();
    assert.equal(result.state.entrySettledBeforeReady, true);
    assert.deepEqual(result.state.events, [
        'appData',
        'storage',
        'userData',
        'sessionData',
        'protocol',
        'startup',
        'startup-ready',
    ]);
    assert.deepEqual(result.state.unhandled, []);
    assert.equal(result.stderr, '');
});

test('bootstrap observes asynchronous startup rejection without exposing private error details', async () => {
    const result = await loadBootstrap(true);
    assert.equal(result.state.entrySettledBeforeReady, true);
    assert.deepEqual(result.state.unhandled, []);
    assert.match(result.stderr, /App startup could not complete/);
    assert.doesNotMatch(result.stderr, /private-startup-detail/);
});
