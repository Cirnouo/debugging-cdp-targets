import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('management composition denies foreign frames/senders, extra payloads and external capabilities before dispatch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-app-window-boundary-'));
    const root = fileURLToPath(new URL('..', import.meta.url));
    try {
        for (const file of ['app.html', 'app-renderer.js', 'app.css', 'icon.png'])
            await writeFile(path.join(directory, file), 'fixture asset');
        const electron = `
import{EventEmitter}from'node:events';
export const state={handlers:new Map(),events:new Map()};
export const ipcMain={handle:(name,fn)=>state.handlers.set(name,fn),removeHandler:name=>state.handlers.delete(name)};
export const contextBridge={exposeInMainWorld:(name,value)=>{state.bridgeName=name;state.bridge=value}};
export const ipcRenderer={invoke:(name,value)=>state.handlers.get(name)(state.ownEvent,value)};
export class BrowserWindow extends EventEmitter{
 constructor(options){super();state.options=options;state.window=this;const contents=new EventEmitter();
  contents.mainFrame={url:'dct-app://manager/'};contents.session={
   setPermissionRequestHandler:fn=>state.permissionRequest=fn,setPermissionCheckHandler:fn=>state.permissionCheck=fn,
   protocol:{handle:async(name,fn)=>{state.protocol=fn;state.scheme=name}}};
  contents.setWindowOpenHandler=fn=>state.openWindow=fn;this.webContents=contents;
  state.ownEvent={sender:contents,senderFrame:contents.mainFrame};}
 setMenu(value){state.menu=value}async loadURL(url){state.loaded=url}destroy(){this.emit('closed')}
}
`;
        const source = `
import assert from'node:assert/strict';import{state}from'electron';
import{createManagementWindow}from${JSON.stringify(path.join(root, 'src/interface/app-window.ts'))};
import${JSON.stringify(path.join(root, 'src/interface/app-preload.ts'))};
const effects={inspect:0,configure:0,quit:0,restart:0};
await createManagementWindow({directory:${JSON.stringify(directory)},inspect:()=>{effects.inspect++;return{phase:'starting'}},configure:async()=>{effects.configure++;return{phase:'starting'}},quit:async()=>{effects.quit++},restart:async()=>{effects.restart++},canDestroy:()=>false,onShutdownFailure(){}});
assert.equal(state.loaded,'dct-app://manager/');assert.equal(state.menu,null);
assert.deepEqual(Object.fromEntries(['nodeIntegration','contextIsolation','sandbox','webSecurity','allowRunningInsecureContent','webviewTag','devTools'].map(key=>[key,state.options.webPreferences[key]])),{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false});
assert.deepEqual(state.openWindow({url:'https://example.invalid'}),{action:'deny'});assert.equal(state.permissionCheck(),false);
let allowed;state.permissionRequest(null,'camera',value=>allowed=value);assert.equal(allowed,false);
for(const name of['will-navigate','will-frame-navigate','will-attach-webview']){let denied=false;state.window.webContents.emit(name,{preventDefault(){denied=true}});assert.equal(denied,true)}
const handler=state.handlers.get('dct-app:manage');
for(const event of[{...state.ownEvent,sender:{}},{...state.ownEvent,senderFrame:{url:'dct-app://manager/'}},{...state.ownEvent,senderFrame:{url:'https://example.invalid'}}])await assert.rejects(()=>handler(event,{action:'quit'}),/rejected/);
await assert.rejects(()=>handler(state.ownEvent,{action:'quit'},{}),/rejected/);
await assert.rejects(()=>handler(state.ownEvent,{action:'quit',registrationBearer:'secret'}));
assert.deepEqual(effects,{inspect:0,configure:0,quit:0,restart:0});
for(const request of[{url:'dct-app://manager/other',method:'GET'},{url:'dct-app://manager/',method:'POST'},{url:'dct-app://manager/',method:'GET',initiatorOrigin:'https://example.invalid'}])assert.equal((await state.protocol(request)).status,404);
const response=await state.protocol({url:'dct-app://manager/',method:'GET'});assert.equal(response.status,200);
const csp=response.headers.get('content-security-policy');for(const rule of["default-src 'self'","connect-src 'none'","frame-src 'none'","object-src 'none'"])assert.ok(csp.includes(rule));
assert.equal(response.headers.get('x-content-type-options'),'nosniff');
assert.equal(state.bridgeName,'dctApp');assert.equal(Object.isFrozen(state.bridge),true);assert.deepEqual(Object.keys(state.bridge).sort(),['configure','inspect','quit','restart']);
assert.deepEqual(await state.bridge.inspect(),{phase:'starting'});assert.equal(effects.inspect,1);
await assert.rejects(async()=>state.bridge.configure({schemaVersion:1,port:0,appearance:'system'}));assert.equal(effects.configure,0);
await state.bridge.quit();assert.equal(effects.quit,1);await state.bridge.restart();assert.equal(effects.restart,1);
state.window.destroy();assert.equal(state.handlers.size,0);
console.log('window and preload boundaries verified with Electron I/O replaced');
`;
        const result = await build({
            stdin: { contents: source, resolveDir: root },
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            write: false,
            plugins: [
                {
                    name: 'electron-boundary',
                    setup(builder) {
                        builder.onResolve({ filter: /^electron$/ }, () => ({
                            path: 'electron',
                            namespace: 'boundary',
                        }));
                        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ contents: electron }));
                    },
                },
            ],
        });
        const file = result.outputFiles[0];
        assert.ok(file);
        const child = spawnSync(process.execPath, ['--input-type=module'], {
            input: file.contents,
            windowsHide: true,
            encoding: 'utf8',
        });
        assert.equal(child.status, 0, child.stderr);
        assert.match(child.stdout, /boundaries verified/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
