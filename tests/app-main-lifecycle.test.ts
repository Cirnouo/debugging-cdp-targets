import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { AppUiSnapshot } from '../src/domains/app-ui.ts';
import { isRecord } from '../src/shared/errors.ts';

type State = {
    mode: string;
    catalogFails: boolean;
    cleanupFails: boolean;
    nativeEntered: Promise<void>;
    routerEntered: Promise<void>;
    releaseNative(): void;
    releaseRouter(): void;
    quit(): void;
    quitManagement(): Promise<void>;
    inspect(): AppUiSnapshot;
    counts: {
        exits: number;
        locks: number;
        data: number;
        http: number;
        closes: number;
        windowDestroyed: number;
        activationClosed: number;
        cacheCleaned: number;
    };
};
type Harness = { state: State; run(): Promise<void> };
function harness(value: unknown): asserts value is Harness {
    assert.ok(isRecord(value) && typeof value.run === 'function' && isRecord(value.state));
}

// Electron, storage and process adapters are I/O fixtures. Core construction/cleanup is the maintained real core.
async function component() {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-app-main-component-'));
    const evidence = await readFile(path.join(root, 'tooling/app-native-release.json'), 'utf8');
    const stateModule = `
import { EventEmitter } from 'node:events';
function deferred(){let release;const promise=new Promise(resolve=>{release=resolve});return{promise,release}}
const native=deferred(),nativeEntered=deferred(),router=deferred(),routerEntered=deferred();
export const state={mode:'router-pending',catalogFails:false,cleanupFails:false,
 counts:{exits:0,locks:0,data:0,http:0,closes:0,windowDestroyed:0,activationClosed:0,cacheCleaned:0},
 nativeEntered:nativeEntered.promise,routerEntered:routerEntered.promise,
 releaseNative:()=>native.release(),releaseRouter:()=>router.release(),
 quit:()=>app.quit(),quitManagement:()=>state.management.quit(),inspect:()=>state.management.inspect(),
 native,signalNative:()=>nativeEntered.release(),router,signalRouter:()=>routerEntered.release()};
export const app=new EventEmitter();
app.whenReady=async()=>{};app.relaunch=()=>{};
app.quit=()=>{let prevented=false;app.emit('before-quit',{preventDefault(){prevented=true}});if(!prevented){state.counts.exits++;app.emit('will-quit')}};
export const Menu={buildFromTemplate:()=>[]},nativeImage={createFromPath:()=>({setTemplateImage(){}})};
export class Tray{constructor(){throw Error('No OS tray in this I/O fixture')}}
`;
    const coreModule = `
import { createGatewayCore as actualCore } from ${JSON.stringify(path.join(root, 'src/application/plugin-runtime.ts'))};
import { createToolCatalog } from ${JSON.stringify(path.join(root, 'src/adapters/tool-catalog.ts'))};
import { state } from 'app-test-state';
export async function createGatewayCore(options){return actualCore({...options,
createRouter:async()=>{state.signalRouter();if(state.mode==='router-pending')await state.router.promise;return{url:'http://127.0.0.1:30000',isBusy:()=>false,setTarget(){},clearTarget(){},close:async()=>{}}},
createConnection:async()=>({tools:[],call:async()=>({content:[]}),onExit(){},rootsChanged:async()=>{},close:async()=>{state.counts.closes++;if(state.cleanupFails)throw Error('Owned close refused')}}),
loadCatalog:async()=>{if(state.catalogFails)throw Error('Catalog failed');return createToolCatalog({version:'1.11.0',tools:[]})}
})}
`;
    const modules: Record<string, string> = {
        electron: `export { app, Menu, nativeImage, Tray } from 'app-test-state';`,
        'app-test-state': stateModule,
        '../application/plugin-runtime.ts': coreModule,
        '../adapters/app-native.ts': `import{state}from'app-test-state';export async function loadAppAdvisoryLock(){state.signalNative();if(state.mode==='native-pending')await state.native.promise;return()=>true}`,
        '../adapters/app-singleton.ts': `import{state}from'app-test-state';export function acquireAppSingleton(){state.counts.locks++;return{ownsSingleton:true,paths:{activation:'fixture-only'}}}`,
        '../adapters/app-activation.ts': `import{state}from'app-test-state';export async function activateExistingApp(){return false}export async function listenForAppActivation(){return{close:async()=>{state.counts.activationClosed++}}}`,
        '../adapters/app-storage.ts': `import{state}from'app-test-state';export function selectAppDataDirectory(){return'fixture-only'}export async function prepareAppDataDirectory(){state.counts.data++;return'fixture-only'}`,
        '../adapters/app-configuration.ts': `export async function openAppConfiguration(){const config={schemaVersion:1,port:27637,appearance:'system'};return{state:()=>({desired:config,effective:config,restartRequired:false}),save:async()=>{}}}`,
        '../adapters/app-official-runtime.ts': `export async function verifyAppOfficialRuntime(){return{nodeExecutable:'fixture-only-node',bin:'fixture-only-public-bin'}}`,
        '../adapters/file-evidence.ts': `export async function readRegularFile(file){return Buffer.from(file.endsWith('distribution.json')?JSON.stringify({schemaVersion:1,kind:'portable',platform:process.platform,architecture:process.arch}):${JSON.stringify(evidence)})}`,
        '../adapters/mcp-http-server.ts': `import{state}from'app-test-state';export async function createMcpHttpServer(options){state.counts.http++;state.accepting=options.accepting;return{close:async()=>{}}}`,
        './app-window.ts': `import{state}from'app-test-state';export async function createManagementWindow(options){state.management=options;let destroyed=false;return{window:{isDestroyed:()=>destroyed,destroy(){destroyed=true;state.counts.windowDestroyed++},webContents:{reload(){}}},activate(){}}}`,
    };
    try {
        const bundled = await build({
            stdin: {
                contents: `export{startDesktopApp}from${JSON.stringify(path.join(root, 'src/interface/app-main.ts'))};export{state}from'app-test-state';import{state}from'app-test-state';import{startDesktopApp}from${JSON.stringify(path.join(root, 'src/interface/app-main.ts'))};export const run=()=>startDesktopApp({appData:'fixture-only',chromium:{cleanup:async()=>{state.counts.cacheCleaned++}}});`,
                resolveDir: root,
            },
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            write: false,
            banner: {
                js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
            },
            plugins: [
                {
                    name: 'app-io-component',
                    setup(builder) {
                        builder.onResolve({ filter: /.*/ }, (args) => {
                            if (
                                args.path === 'app-test-state' ||
                                args.path === 'electron' ||
                                (args.importer.replaceAll('\\', '/').endsWith('/src/interface/app-main.ts') &&
                                    modules[args.path])
                            )
                                return { path: args.path, namespace: 'app-io-component' };
                            return undefined;
                        });
                        builder.onLoad({ filter: /.*/, namespace: 'app-io-component' }, (args) => ({
                            contents: modules[args.path] ?? '',
                            resolveDir: root,
                        }));
                    },
                },
            ],
        });
        const output = path.join(directory, 'app-main-component.mjs');
        const file = bundled.outputFiles[0];
        assert.ok(file);
        await writeFile(output, file.contents);
        const loaded: unknown = await import(pathToFileURL(output).href);
        harness(loaded);
        return { ...loaded, close: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}

async function until(condition: () => boolean) {
    for (let index = 0; index < 100; index++) {
        if (condition()) return;
        await delay(2);
    }
    assert.ok(condition(), 'App component did not reach its bounded terminal state.');
}

test('Quit during native verification waits the whole startup and acquires no singleton or selected data afterward', async () => {
    const f = await component();
    try {
        f.state.mode = 'native-pending';
        const running = f.run();
        await f.state.nativeEntered;
        f.state.quit();
        await delay(0);
        assert.equal(f.state.counts.exits, 0);
        f.state.releaseNative();
        await running;
        await until(() => f.state.counts.exits === 1);
        assert.equal(f.state.counts.locks, 0);
        assert.equal(f.state.counts.data, 0);
        assert.equal(f.state.counts.http, 0);
    } finally {
        await f.close();
    }
});

test('Quit during real catalog construction waits late acquisition cleanup and never admits HTTP', async () => {
    const f = await component();
    try {
        const running = f.run();
        await f.state.routerEntered;
        const quitting = f.state.quitManagement();
        await delay(0);
        assert.equal(f.state.inspect().phase, 'closing');
        assert.equal(f.state.counts.exits, 0);
        f.state.releaseRouter();
        await running;
        await quitting;
        assert.equal(f.state.counts.http, 0);
        assert.equal(f.state.counts.closes, 1);
        assert.equal(f.state.counts.windowDestroyed, 1);
        assert.equal(f.state.counts.exits, 1);
    } finally {
        await f.close();
    }
});

test('failed real core construction and failed cleanup retain manager ownership until a successful Quit retry', async () => {
    const f = await component();
    try {
        f.state.mode = 'immediate';
        f.state.catalogFails = true;
        f.state.cleanupFails = true;
        await f.run();
        assert.equal(f.state.inspect().phase, 'failed');
        await assert.rejects(f.state.quitManagement());
        assert.equal(f.state.inspect().phase, 'closing');
        assert.equal(f.state.counts.exits, 0);
        assert.equal(f.state.counts.windowDestroyed, 0);
        assert.equal(f.state.counts.activationClosed, 0);
        const attempts = f.state.counts.closes;
        f.state.cleanupFails = false;
        await f.state.quitManagement();
        assert.ok(f.state.counts.closes > attempts);
        assert.equal(f.state.counts.exits, 1);
        assert.equal(f.state.counts.activationClosed, 1);
    } finally {
        await f.close();
    }
});
