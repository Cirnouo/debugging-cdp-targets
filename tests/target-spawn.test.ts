import assert from 'node:assert/strict';
import childProcess, { ChildProcess, execFile, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { createTargetHost, spawnPortableApplication } from '../src/adapters/target-host.ts';

// Only launcher construction and native I/O are observed/replaced. The factories,
// Windows identity validator, target ownership and port reservations remain real.
async function targetFactoryHarness(native: { platform: string; architecture: string }, scenario: string) {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-target-factory-'));
    const launcher = path.join(root, 'src/adapters/windows-launch.ts');
    const reservations = path.join(root, 'src/adapters/port-reservation.ts');
    const profile = path.join(root, 'src/adapters/chrome-profile.ts');
    const state = `export const effects={launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0};`;
    try {
        const bundle = await build({
            stdin: {
                contents: `export {createTargetHost} from './src/adapters/target-host.ts';
export {createPlatformAdapter} from './src/adapters/platform-process.ts';
export {createWindowsLauncher} from './src/adapters/windows-launch.ts';
export {createPortReservations} from './src/adapters/port-reservation.ts';
export {effects} from 'target-factory-state';`,
                resolveDir: root,
            },
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            write: false,
            plugins: [
                {
                    name: 'target-native-boundaries',
                    setup(builder) {
                        builder.onResolve({ filter: /.*/ }, (args) => {
                            if (args.path === 'target-factory-state')
                                return { path: args.path, namespace: 'target-native-boundaries' };
                            const importer = args.importer.replaceAll('\\', '/');
                            if (
                                args.path === './windows-launch.ts' &&
                                (importer.endsWith('/src/adapters/target-host.ts') ||
                                    importer.endsWith('/src/adapters/platform-process.ts'))
                            )
                                return { path: 'launcher', namespace: 'target-native-boundaries' };
                            if (
                                args.path === './port-reservation.ts' &&
                                importer.endsWith('/src/adapters/target-host.ts')
                            )
                                return { path: 'reservations', namespace: 'target-native-boundaries' };
                            if (
                                args.path === './chrome-profile.ts' &&
                                importer.endsWith('/src/adapters/target-host.ts')
                            )
                                return { path: 'profile', namespace: 'target-native-boundaries' };
                            return undefined;
                        });
                        builder.onLoad({ filter: /.*/, namespace: 'target-native-boundaries' }, (args) => ({
                            contents:
                                args.path === 'target-factory-state'
                                    ? state
                                    : args.path === 'launcher'
                                      ? `import{createWindowsLauncher as actual}from${JSON.stringify(launcher)};import{effects}from'target-factory-state';export function createWindowsLauncher(options){effects.launchers++;return actual(options)}`
                                      : args.path === 'profile'
                                        ? `import{profileAvailable as actual}from${JSON.stringify(profile)};export{chromeProfileArgument,reserveProfile}from${JSON.stringify(profile)};import{effects}from'target-factory-state';export function profileAvailable(...args){effects.profiles++;return actual(...args)}`
                                        : `import{createPortReservations as actual}from${JSON.stringify(reservations)};import{effects}from'target-factory-state';export function createPortReservations(){effects.reservations++;return actual()}`,
                            resolveDir: root,
                        }));
                    },
                },
            ],
        });
        const output = bundle.outputFiles[0];
        assert.ok(output);
        await writeFile(path.join(directory, 'factories.mjs'), output.contents);
        await writeFile(
            path.join(directory, 'case.mjs'),
            `
import assert from 'node:assert/strict';
import childProcess,{ChildProcess} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {mock} from 'node:test';
Object.defineProperty(process,'platform',{value:${JSON.stringify(native.platform)}});
Object.defineProperty(process,'arch',{value:${JSON.stringify(native.architecture)}});
const {createTargetHost,createPlatformAdapter,createWindowsLauncher,createPortReservations,effects}=await import('./factories.mjs');
const blocked=key=>()=>{effects[key]++;throw Error('Blocked ambient '+key)};
mock.method(childProcess,'spawn',blocked('spawn'));
mock.method(ChildProcess.prototype,'spawn',blocked('spawn'));
for(const name of ['readFile','readlink','open','realpath'])mock.method(fs,name,blocked('files'));
mock.method(net,'createServer',blocked('ports'));
mock.method(globalThis,'fetch',blocked('queries'));
syncBuiltinESMExports();
${scenario}
console.log('verified');
`,
        );
        const result = await promisify(execFile)(process.execPath, [path.join(directory, 'case.mjs')], {
            windowsHide: true,
            timeout: 10_000,
            env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
        });
        assert.equal(result.stdout.trim(), 'verified');
        assert.equal(result.stderr, '');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

for (const native of [
    { platform: 'linux', architecture: 'x64' },
    { platform: 'darwin', architecture: 'arm64' },
    { platform: 'win32', architecture: 'ia32' },
]) {
    for (const factory of ['createTargetHost', 'createPlatformAdapter']) {
        test(`unsupported default ${factory} acquires no resources on ${native.platform}/${native.architecture}`, async () => {
            await targetFactoryHarness(
                native,
                `
assert.throws(()=>${factory}(),/unsupported.*(?:Windows|platform|operating|architecture)/i);
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
            );
        });
    }
}

test('explicit Windows target evidence uses only supplied I/O on a non-Windows test host', async () => {
    await targetFactoryHarness(
        { platform: 'linux', architecture: 'x64' },
        `
const supplied={ranges:0,snapshots:0,spawn:0,probe:0,version:0,profile:0,close:0};
const child=Object.assign(new EventEmitter(),{pid:601,exitCode:null,signalCode:null});
const startedAtUtc='2026-10-04T00:00:00.000Z';
let finishExit;
const exit=new Promise(resolve=>{finishExit=resolve});
const platform=createPlatformAdapter({platform:'win32',architecture:'x64',
 reservedRanges:async()=>{supplied.ranges++;return[]},
 snapshot:async()=>{supplied.snapshots++;return{root:{exists:true,executablePath:process.execPath,startedAtUtc,sessionId:41},currentSessionId:41,processIds:[601],listeners:[{localAddress:'127.0.0.1',owningProcess:601}]}},
 requestWindowsClose:async target=>{assert.equal(target.processId,601);supplied.close++;return{closeRequested:true,processExited:false}},
 waitWindowsExit:async()=>{await exit;return{processId:601,startedAtUtc,closed:true,processExited:true,waitResult:0,waitError:0}}
});
const owned=createPortReservations();
const host=createTargetHost({platform:'win32',architecture:'x64',platformAdapter:platform,portReservations:owned,
 now:()=>Date.parse(startedAtUtc),
 spawn:async()=>{supplied.spawn++;return child},probe:async()=>{supplied.probe++;return true},
 profileAvailable:async()=>{supplied.profile++;return true},
 getVersion:async port=>{supplied.version++;return{Browser:'Fixture/1.0',webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/browser/owned'}}
});
const target=await host.launch({isolation:{mode:'none'},targetKind:'generic-cdp',launch:{executable:process.execPath},basePort:19333});
assert.equal(target.processId,601);
assert.equal(owned.claim(19333),undefined);
assert.equal((await host.requestNormalClose(target)).processExited,false);
assert.equal(owned.claim(19333),undefined);
child.exitCode=0;child.emit('exit',0);finishExit();
await host.waitForExit(target);
const release=owned.claim(19333);assert.ok(release);release();
assert.deepEqual(supplied,{ranges:1,snapshots:2,spawn:1,probe:1,version:1,profile:0,close:1});
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
    );
});

test('default Windows launcher refuses unsupported ambient identity before helper construction or spawn', async () => {
    await targetFactoryHarness(
        { platform: 'linux', architecture: 'x64' },
        `
assert.throws(()=>createWindowsLauncher(),/unsupported.*(?:Windows|platform|operating|architecture)/i);
assert.equal(effects.spawn,0);
`,
    );
});

test('supplied Windows identity cannot construct a default target launcher on an unsupported host', async () => {
    await targetFactoryHarness(
        { platform: 'linux', architecture: 'x64' },
        `
assert.throws(()=>createTargetHost({platform:'win32',architecture:'x64',platformAdapter:{
 reservedRanges:async()=>[],snapshot:async()=>({root:{exists:false},currentSessionId:0,processIds:[],listeners:[]}),
 validateNewRoot(){},close:async()=>true
}}),/unsupported.*(?:Windows|platform|operating|architecture)/i);
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
    );
});

for (const operation of ['snapshot', 'reservedRanges']) {
    test(`supplied Windows identity cannot enable default native ${operation} on an unsupported host`, async () => {
        await targetFactoryHarness(
            { platform: 'linux', architecture: 'x64' },
            `
const adapter=createPlatformAdapter({platform:'win32',architecture:'x64',
 requestWindowsClose:async()=>({closeRequested:true}),waitWindowsExit:async()=>({})});
await assert.rejects(adapter.${operation}(601,19333),/unsupported.*(?:Windows|platform|operating|architecture)/i);
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
        );
    });
}

test('supplied Windows adapter identity accepts executable case differences on a non-Windows host', async () => {
    await targetFactoryHarness(
        { platform: 'linux', architecture: 'x64' },
        `
const target={processId:601,port:19333,executablePath:'C:/Program Files/App/app.exe',startedAtUtc:'2026-10-04T00:00:00.000Z',targetKind:'chrome'};
const evidence={root:{exists:true,executablePath:'c:/program files/app/APP.exe',startedAtUtc:target.startedAtUtc,sessionId:41,productName:'Google Chrome',companyName:'Google LLC'},currentSessionId:41,processIds:[601],listeners:[]};
const platform=createPlatformAdapter({platform:'win32',architecture:'x64',snapshot:async()=>evidence,reservedRanges:async()=>[],
 closeWindows:async()=>({processId:601,startedAtUtc:target.startedAtUtc,closed:true,processExited:true,waitResult:0,waitError:0})});
assert.doesNotThrow(()=>platform.validateNewRoot(evidence,target));
assert.equal(await platform.close(target),true);
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
    );
});

test('supplied Windows adapter identity rejects unverified Chrome vendor evidence on a non-Windows host', async () => {
    await targetFactoryHarness(
        { platform: 'linux', architecture: 'x64' },
        `
const target={processId:601,port:19333,executablePath:process.execPath,startedAtUtc:'2026-10-04T00:00:00.000Z',targetKind:'chrome'};
const evidence={root:{exists:true,executablePath:process.execPath,startedAtUtc:target.startedAtUtc,sessionId:41,productName:'Other Browser',companyName:'Other Company'},currentSessionId:41,processIds:[601],listeners:[]};
let closed=0;
const platform=createPlatformAdapter({platform:'win32',architecture:'x64',snapshot:async()=>evidence,reservedRanges:async()=>[],
 closeWindows:async()=>{closed++;return{processId:601,startedAtUtc:target.startedAtUtc,closed:true,processExited:true,waitResult:0,waitError:0}}});
assert.throws(()=>platform.validateNewRoot(evidence,target),/Google Chrome/);
await assert.rejects(platform.close(target),/Google Chrome/);
assert.equal(closed,0);
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
    );
});

test('supplied Windows target evidence keeps Chrome vendor checks during verification and health', async () => {
    await targetFactoryHarness(
        { platform: 'linux', architecture: 'x64' },
        `
const child=Object.assign(new EventEmitter(),{pid:601,exitCode:null,signalCode:null});
const startedAtUtc='2026-10-04T00:00:00.000Z';
let companyName='Google LLC';
const adapter=createPlatformAdapter({platform:'win32',architecture:'x64',reservedRanges:async()=>[],
 snapshot:async()=>({root:{exists:true,executablePath:process.execPath,startedAtUtc,sessionId:41,productName:'Google Chrome',companyName},currentSessionId:41,processIds:[601],listeners:[{localAddress:'127.0.0.1',owningProcess:601}]}),
 closeWindows:async()=>({processId:601,startedAtUtc,closed:true,processExited:true,waitResult:0,waitError:0})});
const host=createTargetHost({platform:'win32',architecture:'x64',platformAdapter:{...adapter,reservedRanges:async()=>[]},portReservations:createPortReservations(),
 now:()=>Date.parse(startedAtUtc),spawn:async()=>child,probe:async()=>true,profileAvailable:async()=>true,
 getVersion:async port=>({Browser:'Chrome/153',webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/browser/chrome'})});
const target=await host.launch({isolation:{mode:'none'},targetKind:'chrome',launch:{executable:process.execPath},basePort:19333});
assert.ok(target.verify);
await target.verify();
assert.equal(await host.health(target),'healthy');
companyName='Unverified Company';
await assert.rejects(target.verify(),/Google Chrome/);
assert.equal(await host.health(target),'identity-changed');
child.exitCode=0;child.emit('exit',0);
assert.deepEqual(effects,{launchers:0,reservations:0,profiles:0,spawn:0,files:0,ports:0,queries:0});
`,
    );
});

test('portable direct launch keeps its GUI visible and detached without a shell or inherited stdio', async (context) => {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 42 });
    let unreferenced = false;
    context.mock.method(child, 'unref', () => {
        unreferenced = true;
    });
    const launches: { executable: string; arguments: readonly string[]; options: SpawnOptions }[] = [];
    const nativeSpawn = context.mock.method(
        childProcess,
        'spawn',
        (executable: string, arguments_: readonly string[], options: SpawnOptions) => {
            launches.push({ executable, arguments: arguments_, options });
            queueMicrotask(() => child.emit('spawn'));
            return child;
        },
    );
    syncBuiltinESMExports();
    try {
        const host = createTargetHost({
            platform: 'win32',
            architecture: 'x64',
            spawn: spawnPortableApplication,
            platformAdapter: {
                reservedRanges: async () => [],
                snapshot: async () => ({
                    root: {
                        exists: true,
                        executablePath: process.execPath,
                        sessionId: 1,
                        startedAtUtc: '2026-09-30T00:00:00Z',
                    },
                    processIds: [42],
                    currentSessionId: 1,
                    listeners: [{ localAddress: '127.0.0.1', owningProcess: 42 }],
                }),
                validateNewRoot: () => {},
                close: async () => true,
            },
            probe: async () => true,
            getVersion: async () => ({
                Browser: 'Chrome/154.0.8037.93',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/visible-target',
            }),
        });
        const target = await host.launch({
            isolation: { mode: 'none' },
            launch: {
                executable: process.execPath,
                args: ['--remote-debugging-port={port}'],
                env: { DCT_TEST_LAUNCH_VALUE: 'a b 中文' },
            },
            basePort: 9222,
        });
        assert.equal(target.processId, 42);
        assert.equal(unreferenced, true, 'Keep must allow the gateway to exit independently of the target');
        assert.equal(launches[0]?.options.env?.DCT_TEST_LAUNCH_VALUE, 'a b 中文');
        assert.deepEqual(
            launches.map(({ options, ...rest }) => {
                const { env, ...processOptions } = options;
                assert.ok(env);
                return { ...rest, options: processOptions };
            }),
            [
                {
                    executable: process.execPath,
                    arguments: ['--remote-debugging-port=9222'],
                    options: {
                        cwd: path.dirname(process.execPath),
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: false,
                        shell: false,
                    },
                },
            ],
        );
    } finally {
        nativeSpawn.mock.restore();
        syncBuiltinESMExports();
    }
});

test('permission waiting does not consume CDP startup time and pre-cancelled launches create no application', async () => {
    let clock = Date.parse('2026-10-04T00:00:00Z');
    const abort = new AbortController();
    const closed: number[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 101, exitCode: null });
    const host = createTargetHost({
        platform: 'win32',
        architecture: 'x64',
        now: () => clock,
        probe: async () => true,
        spawn: async () => {
            clock += 90_000;
            return child;
        },
        platformAdapter: {
            reservedRanges: async () => [],
            snapshot: async () => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: new Date(clock).toISOString(),
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [101],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: 101 }],
            }),
            validateNewRoot: () => {},
            close: async (target) => {
                closed.push(target.processId);
                child.emit('exit', 0);
                return true;
            },
        },
        getVersion: async () => ({
            Browser: 'Chrome/154',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready',
        }),
    });
    const active = await host.launch(
        { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
        { signal: abort.signal },
    );
    assert.equal(active.processId, 101);
    assert.deepEqual(closed, []);

    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
            { signal: cancelled.signal },
        ),
        /abort/i,
    );
    assert.deepEqual(closed, []);
});

test('cancellation racing with endpoint readiness closes the newly created application', async () => {
    const abort = new AbortController();
    const closed: number[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 102, exitCode: null });
    const host = createTargetHost({
        platform: 'win32',
        architecture: 'x64',
        probe: async () => true,
        spawn: async () => child,
        platformAdapter: {
            reservedRanges: async () => [],
            snapshot: async () => ({
                root: {
                    exists: true,
                    executablePath: process.execPath,
                    startedAtUtc: new Date().toISOString(),
                    sessionId: 1,
                },
                currentSessionId: 1,
                processIds: [102],
                listeners: [{ localAddress: '127.0.0.1', owningProcess: 102 }],
            }),
            validateNewRoot: () => {},
            close: async (target) => {
                closed.push(target.processId);
                child.emit('exit', 0);
                return true;
            },
        },
        getVersion: async () => {
            abort.abort();
            return { Browser: 'Chrome/154', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/ready' };
        },
    });
    await assert.rejects(
        host.launch(
            { isolation: { mode: 'none' }, launch: { executable: process.execPath } },
            { signal: abort.signal },
        ),
        /abort/i,
    );
    assert.deepEqual(closed, [102]);
});
