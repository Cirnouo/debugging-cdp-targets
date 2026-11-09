import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { verifyAppNativeInputs } from '../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../src/domains/app-release.ts';
import { isRecord } from '../src/shared/errors.ts';

test('native input verification checks original package closure without loading the binary addon', async () => {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('fs-native-extensions');
    assert.equal(require.cache[entry], undefined);
    const evidence = parseAppNativeEvidence(
        JSON.parse(await readFile(new URL('../tooling/app-native-release.json', import.meta.url), 'utf8')),
    );
    const verified = await verifyAppNativeInputs(evidence);
    assert.equal(verified.size, 6);
    assert.equal(verified.get('fs-native-extensions')?.files.size, 38);
    assert.equal(require.cache[entry], undefined);
});

for (const native of [
    { platform: 'linux', architecture: 'x64' },
    { platform: 'darwin', architecture: 'arm64' },
    { platform: 'win32', architecture: 'ia32' },
]) {
    test(`unsupported advisory loading refuses before package verification or dlopen on ${native.platform}/${native.architecture}`, async () => {
        const result = await promisify(execFile)(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `
import childProcess,{ChildProcess} from 'node:child_process';
import filesystem from 'node:fs';
import fs from 'node:fs/promises';
import Module,{syncBuiltinESMExports} from 'node:module';
import {loadAppAdvisoryLock} from ${JSON.stringify(new URL('../src/adapters/app-native.ts', import.meta.url).href)};
import {parseAppNativeEvidence} from ${JSON.stringify(new URL('../src/domains/app-release.ts', import.meta.url).href)};
// Valid reviewed evidence is read and parsed before blocking the verification boundary.
const evidence=parseAppNativeEvidence(JSON.parse(await fs.readFile(new URL(${JSON.stringify(new URL('../tooling/app-native-release.json', import.meta.url).href)}),'utf8')));
const effects={resolve:0,read:0,lstat:0,open:0,mkdir:0,realpath:0,statfs:0,query:0,dlopen:0};
const blocked=key=>()=>{effects[key]++;throw Error('Blocked unexpected native acquisition: '+key)};
Object.defineProperty(process,'platform',{value:${JSON.stringify(native.platform)}});
Object.defineProperty(process,'arch',{value:${JSON.stringify(native.architecture)}});
Module._resolveFilename=blocked('resolve');
for(const [name,key] of [['readFile','read'],['lstat','lstat'],['open','open'],['mkdir','mkdir'],['realpath','realpath'],['statfs','statfs'],['readdir','read'],['readlink','read']])fs[name]=blocked(key);
for(const [name,key] of [['readFileSync','read'],['lstatSync','lstat'],['openSync','open'],['mkdirSync','mkdir'],['realpathSync','realpath'],['statfsSync','statfs']])filesystem[name]=blocked(key);
for(const name of ['spawn','spawnSync','execFile','execFileSync','execSync'])childProcess[name]=blocked('query');
ChildProcess.prototype.spawn=blocked('query');
process.dlopen=blocked('dlopen');
syncBuiltinESMExports();
let rejected=false,message='';
try{await loadAppAdvisoryLock(evidence)}catch(error){rejected=true;message=error instanceof Error?error.message:'Non-Error rejection'}
console.log(JSON.stringify({rejected,message,effects}));
`,
            ],
            {
                windowsHide: true,
                timeout: 10_000,
                env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
            },
        );
        assert.equal(result.stderr, '');
        const value: unknown = JSON.parse(result.stdout);
        assert.ok(isRecord(value));
        assert.equal(value.rejected, true);
        assert.deepEqual(value.effects, {
            resolve: 0,
            read: 0,
            lstat: 0,
            open: 0,
            mkdir: 0,
            realpath: 0,
            statfs: 0,
            query: 0,
            dlopen: 0,
        });
        assert.ok(typeof value.message === 'string');
        assert.match(value.message, /unsupported/i);
        assert.match(value.message, /Windows/);
        assert.match(value.message, /x64/);
        assert.match(value.message, /arm64/);
    });
}
