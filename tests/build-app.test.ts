import assert from 'node:assert/strict';
import { ChildProcess, execFile, spawnSync } from 'node:child_process';
import fs, { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { verifyAppNativeInputs } from '../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../src/domains/app-release.ts';
import { isRecord } from '../src/shared/errors.ts';
import { generateAppFiles, readAppOfficialFiles } from '../tooling/build-app.ts';
import { parseOfficialSmokeArguments } from '../tooling/smoke-official-catalog.ts';

test('official catalog evidence requires one explicit source mode and never silently falls back', () => {
    const stage = fileURLToPath(new URL('.', import.meta.url));
    assert.deepEqual(parseOfficialSmokeArguments(['--installed']), { kind: 'installed' });
    assert.deepEqual(parseOfficialSmokeArguments(['--stage', stage]), { kind: 'stage', directory: stage });
    for (const args of [
        [],
        ['--stage'],
        ['--installed', '--stage', stage],
        ['--stage', stage, '--installed'],
        ['--stage', '--installed'],
        ['--unknown'],
    ])
        assert.throws(() => parseOfficialSmokeArguments(args));
});

test('App build separates synchronous bootstrap and emits only sandboxed local renderer assets with actual licenses', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    let actualInputs: readonly string[] = [];
    const files = await generateAppFiles({
        root,
        kind: 'portable',
        platform: 'win32',
        architecture: 'x64',
        onInputs: async (inputs) => {
            actualInputs = inputs;
        },
    });
    assert.equal(
        actualInputs.some((input) =>
            /cfWorkerProvider-|shimsBrowser\.mjs|shimsWorkerd\.mjs|validators[\\/]cfWorker\.mjs/.test(input),
        ),
        false,
        'Optional browser/workerd SDK providers must stay outside the actual App graph.',
    );
    for (const input of [
        'src/desktop/configuration/model.ts',
        'src/desktop/configuration/store.ts',
        'src/desktop/contracts/commands.ts',
        'src/desktop/contracts/snapshots.ts',
        'src/desktop/main/asset-policy.ts',
        'src/desktop/renderer/elapsed.ts',
        'src/gateway/core.ts',
        'src/gateway/registry.ts',
        'src/gateway/targets/target-lifecycle.ts',
        'tooling/licenses/bundled-notices.ts',
        'tooling/licenses/canonical-inputs.ts',
        'tooling/licenses/reviewed-vendors.json',
        'src/gateway/connections/resource-owner.ts',
        'src/gateway/connections/directory-lease.ts',
        'src/gateway/connections/workspace-policy.ts',
        'src/gateway/connections/managed-connection.ts',
        'src/gateway/connections/start-admission.ts',
        'src/gateway/connections/connection-view.ts',
        'src/gateway/owned-tool-arguments.ts',
        'src/gateway/diagnostics.ts',
        'src/gateway/targets/model/cdp-identity.ts',
        'src/gateway/targets/model/target-contract.ts',
        'src/gateway/targets/model/chrome-profile-argument.ts',
        'src/gateway/targets/model/chromium-features.ts',
        'src/gateway/targets/model/isolation.ts',
        'src/gateway/targets/model/launch-command.ts',
        'src/shared/environment-key.ts',
        'src/gateway/official/release-evidence.ts',
        'src/gateway/official/package-files.ts',
        'src/gateway/official/server-launch.ts',
        'src/gateway/official/upstream.ts',
        'src/shared/payload-path.ts',
        'src/domains/control-contract.ts',
        'src/domains/mcp-http.ts',
        'src/adapters/mcp-request-handler.ts',
        'src/application/host-plugin-manager.ts',
        'src/host-plugins/payload-integrity.ts',
        'src/host-plugins/user-intent.ts',
        'src/host-plugins/native/user-intent-file.ts',
        'src/adapters/verified-plugin-files.ts',
        'src/adapters/native-host-plugins.ts',
        'src/adapters/managed-plugin-receipts.ts',
    ])
        assert.ok(
            actualInputs.some((name) => name.replaceAll('\\', '/').endsWith(input)),
            input,
        );
    assert.equal(
        actualInputs.some((name) => name.replaceAll('\\', '/').endsWith('src/shared/diagnostics.ts')),
        false,
    );
    assert.equal(
        actualInputs.some((name) => name.replaceAll('\\', '/').endsWith('src/domains/cdp-target.ts')),
        false,
    );
    for (const oldInput of [
        'src/domains/app-ui.ts',
        'src/domains/app-configuration.ts',
        'src/adapters/app-configuration.ts',
        'src/adapters/host-user-intent.ts',
        'src/application/plugin-runtime.ts',
        'src/application/target-controller.ts',
        'src/adapters/official-package.ts',
        'src/adapters/official-server.ts',
        'src/adapters/mcp-bridge.ts',
        'tooling/build-plugin.ts',
        'tooling/distribution/build-plugin.ts',
        'tooling/distribution/audit-plugins.ts',
        'tooling/distribution/host-metadata.ts',
        'tooling/distribution/host-descriptors.ts',
        'tooling/distribution/payload-inventory.ts',
        'tooling/distribution/artwork-policy.ts',
        'tooling/distribution/regular-file-tree.ts',
        'tooling/distribution/version-agreement.ts',
        'tooling/runtime-license-policy.ts',
        'tooling/vendored-licenses.json',
        'src/application/connection-owner.ts',
        'src/application/connection-directory.ts',
        'src/domains/chrome-profile.ts',
        'src/domains/chromium-features.ts',
        'src/domains/data-isolation.ts',
        'src/domains/launch-command.ts',
    ])
        assert.equal(
            actualInputs.some((name) => name.replaceAll('\\', '/').endsWith(oldInput)),
            false,
            oldInput,
        );
    assert.equal(files.has('macos-deployment-authority.jxa'), false);
    assert.equal(actualInputs.includes('src/adapters/macos-deployment-authority.jxa'), false);
    for (const name of ['windows-cdp-helper.ps1', 'windows-native-helper.ps1', 'windows-native-process.cs']) {
        assert.ok(files.has(name), `Missing fixed Windows helper: ${name}`);
        assert.ok(files.get(name)?.equals(await readFile(new URL(`../src/adapters/${name}`, import.meta.url))));
        assert.ok(actualInputs.includes(`src/adapters/${name}`), `Missing helper source input: ${name}`);
    }
    for (const name of [
        'windows-deployment-authority.ps1',
        'windows-deployment-create.ps1',
        'windows-deployment-authority.cs',
        'windows-deployment-create.cs',
        'windows-deployment-query.exe',
        'windows-deployment-create.exe',
    ]) {
        assert.equal(files.has(name), false, `Build-only deployment input was delivered: ${name}`);
        assert.equal(actualInputs.includes(`src/adapters/${name}`), false);
    }
    for (const bytes of files.values())
        assert.doesNotMatch(bytes.toString(), /dct-deployment-support-|Framework64\\\\v4\.0\.30319/);
    for (const name of ['semver', 'smol-toml'])
        assert.ok(
            actualInputs.some((input) => input.replaceAll('\\', '/').includes(`/node_modules/${name}/`)),
            name,
        );
    for (const [name, bytes] of files) {
        if (!/\.(?:mjs|cjs|js)$/.test(name) || name.startsWith('node_modules/')) continue;
        const checked = spawnSync(
            process.execPath,
            ['--check', '--input-type', name.endsWith('.cjs') ? 'commonjs' : 'module'],
            {
                input: bytes,
                windowsHide: true,
                encoding: 'utf8',
            },
        );
        assert.equal(checked.status, 0, `${name}: ${checked.stderr}`);
    }
    const bootstrap = files.get('app-bootstrap.mjs')?.toString('utf8') ?? '';
    assert.match(bootstrap, /setPath\("userData"/);
    assert.match(bootstrap, /import\("\.\/app-main\.mjs"\)/);
    assert.ok(bootstrap.indexOf('setPath("sessionData"') < bootstrap.indexOf('import("./app-main.mjs")'));
    assert.doesNotMatch(bootstrap, /class Protocol|function createGatewayCore|requestSingleInstanceLock/);
    assert.match(files.get('app-preload.cjs')?.toString('utf8') ?? '', /exposeInMainWorld/);
    assert.doesNotMatch(files.get('app-renderer.js')?.toString('utf8') ?? '', /node:|from "electron"/);
    const notices = files.get('THIRD-PARTY-NOTICES.txt')?.toString('utf8') ?? '';
    for (const dependency of [
        'react',
        'react-dom',
        '@modelcontextprotocol/node',
        'fs-native-extensions',
        'semver',
        'smol-toml',
    ])
        assert.ok(notices.includes(dependency));
    const nativeEvidence = parseAppNativeEvidence(
        JSON.parse(await readFile(new URL('../tooling/app-native-release.json', import.meta.url), 'utf8')),
    );
    const originals = await verifyAppNativeInputs(nativeEvidence);
    assert.equal(originals.size, 6);
    assert.equal(originals.get('fs-native-extensions')?.files.size, 38);
    let originalCount = 0;
    for (const [name, original] of originals) {
        for (const [file, bytes] of original.files) {
            const destination = `node_modules/${name}/${file}`;
            assert.ok(files.get(destination)?.equals(bytes), destination);
            originalCount++;
        }
        const license = original.files.get('LICENSE');
        assert.ok(license);
        assert.ok(notices.includes(`${name} — LICENSE\n\n${license.toString('utf8').trim()}`), name);
    }
    assert.equal([...files.keys()].filter((name) => name.startsWith('node_modules/')).length, originalCount);
    for (const file of [
        'LICENSE',
        'app.html',
        'app.css',
        'icon.png',
        'distribution.json',
        'delivery/app-release-inputs.json',
        'delivery/app-native-release.json',
        'delivery/official-server-release.json',
    ])
        assert.ok(files.has(file), file);
});

type StaticCheckResult = {
    error: string | null;
    state: {
        targets: unknown[];
        bundles: unknown[];
        reads: string[];
        logs: string[];
        effects: Record<string, number>;
        officialInputs: number;
        officialFiles: number;
        nativeInputs: number;
        notices: number;
    };
};

function assertStaticCheckResult(value: unknown): asserts value is StaticCheckResult {
    assert.ok(isRecord(value) && (value.error === null || typeof value.error === 'string'));
    const state = value.state;
    assert.ok(isRecord(state) && Array.isArray(state.targets) && Array.isArray(state.bundles));
    for (const name of ['reads', 'logs']) {
        const entries = state[name];
        assert.ok(Array.isArray(entries) && entries.every((entry: unknown) => typeof entry === 'string'));
    }
    assert.ok(isRecord(state.effects) && Object.values(state.effects).every((count) => typeof count === 'number'));
    for (const name of ['officialInputs', 'officialFiles', 'nativeInputs', 'notices'])
        assert.equal(typeof state[name], 'number');
}

// The maintained CLI and lexical generator run unchanged; only their I/O imports are replaced.
async function staticCheck(native: { platform: string; architecture: string }, portable: boolean) {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const entry = path.join(root, 'tooling/build-app.ts');
    const nativeEvidence = await readFile(path.join(root, 'tooling/app-native-release.json'), 'utf8');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-static-app-check-'));
    const stateUrl = pathToFileURL(path.join(directory, 'state.mjs')).href;
    const stateImport = `import{state,blocked}from${JSON.stringify(stateUrl)};`;
    const modules: Record<string, string> = {
        'node:child_process': `${stateImport}export const execFile=()=>blocked('extraction'),spawn=()=>blocked('spawn');`,
        'node:fs/promises': `${stateImport}
export const mkdir=()=>blocked('mkdir'),mkdtemp=()=>blocked('mkdtemp'),writeFile=()=>blocked('write'),
open=()=>blocked('stage'),lstat=()=>blocked('stage'),rm=()=>blocked('write'),unlink=()=>blocked('write');
export const realpath=async value=>value;
export async function readFile(file){state.reads.push(String(file));return '{"tools":[]}'};`,
        esbuild: `${stateImport}import path from'node:path';export async function build(options){
const entry=path.basename(options.entryPoints[0]);if(entry==='app-bootstrap.ts')state.targets.push(state.distribution);
state.bundles.push({target:state.distribution,entry});
return{outputFiles:[{path:options.outfile,contents:Buffer.from('inert bundle')}],metafile:{inputs:{},outputs:{}}}}`,
        '../src/domains/app-distribution.ts': `${stateImport}
import{parseAppDistribution as actual}from${JSON.stringify(path.join(root, 'src/domains/app-distribution.ts'))};
export function parseAppDistribution(value,native){const result=actual(value,native);state.distribution=result;return result}`,
        '../src/adapters/file-evidence.ts': `${stateImport}import path from'node:path';
export async function readRegularFile(file){state.reads.push(String(file));const name=path.basename(file);
return Buffer.from(name==='package.json'?'{"version":"0.1.0"}':name==='app-native-release.json'?${JSON.stringify(nativeEvidence)}:'inert owned input')}`,
        '../src/adapters/app-native.ts': `${stateImport}
export async function verifyAppNativeInputs(){state.nativeInputs++;return new Map()}
export const loadAppAdvisoryLock=()=>blocked('dlopen');`,
        '../src/adapters/app-delivery.ts': `${stateImport}
export const identifyDeploymentPayload=()=>blocked('stage'),verifyDeploymentPayload=()=>blocked('stage');`,
        '../src/adapters/app-deployment.ts': `${stateImport}
export const createFreshDeploymentInstallation=()=>blocked('stage'),identifyDeploymentInstallation=()=>blocked('stage');`,
        '../src/adapters/windows-deployment-protocol.ts': `${stateImport}
export const packWindowsDeploymentQueries=()=>blocked('stage'),preflightWindowsDeploymentCopy=()=>blocked('stage');`,
        '../src/gateway/official/package-files.ts': `${stateImport}
export async function verifyOfficialPackageFiles(){state.officialFiles++;return new Map()}`,
        './licenses/bundled-notices.ts': `${stateImport}
export async function collectBundledLicenses(){state.notices++;return Buffer.from('inert notices')}`,
        './security/official-inputs.ts': `${stateImport}
export async function verifyOfficialInputs(){state.officialInputs++;return{release:{name:'chrome-devtools-mcp'}}}`,
    };
    try {
        await writeFile(
            path.join(directory, 'state.mjs'),
            `
export const state={distribution:null,targets:[],bundles:[],reads:[],logs:[],
effects:{extraction:0,spawn:0,dlopen:0,mkdir:0,mkdtemp:0,write:0,stage:0},
officialInputs:0,officialFiles:0,nativeInputs:0,notices:0};
export function blocked(name){state.effects[name]++;throw Error('Forbidden static App effect: '+name)}
`,
        );
        const bundle = await build({
            entryPoints: [entry],
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node24',
            write: false,
            define: {
                'process.platform': JSON.stringify(native.platform),
                'process.arch': JSON.stringify(native.architecture),
                'process.argv': JSON.stringify([
                    process.execPath,
                    entry,
                    '--check',
                    ...(portable ? ['--portable'] : []),
                ]),
                'import.meta.url': JSON.stringify(pathToFileURL(entry).href),
            },
            plugins: [
                {
                    name: 'static-app-check-io',
                    setup(builder) {
                        builder.onResolve({ filter: /.*/ }, (args) =>
                            args.path === stateUrl
                                ? { path: stateUrl, external: true }
                                : modules[args.path]
                                  ? { path: args.path, namespace: 'static-app-check-io' }
                                  : undefined,
                        );
                        builder.onLoad({ filter: /.*/, namespace: 'static-app-check-io' }, (args) => ({
                            contents: modules[args.path] ?? '',
                            resolveDir: root,
                        }));
                    },
                },
            ],
        });
        const output = bundle.outputFiles[0];
        assert.ok(output);
        await writeFile(path.join(directory, 'build-app-check.mjs'), output.contents);
        await writeFile(
            path.join(directory, 'loader.mjs'),
            `
import{ChildProcess}from'node:child_process';import{state,blocked}from'./state.mjs';
ChildProcess.prototype.spawn=()=>blocked('spawn');process.dlopen=()=>blocked('dlopen');
console.log=(...values)=>state.logs.push(values.join(' '));
let error=null;try{await import('./build-app-check.mjs')}catch(problem){error=problem instanceof Error?problem.message:'Non-Error rejection'}
process.stdout.write(JSON.stringify({state,error}));
`,
        );
        const result = await promisify(execFile)(process.execPath, [path.join(directory, 'loader.mjs')], {
            windowsHide: true,
            env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
        });
        assert.equal(result.stderr, '');
        const value: unknown = JSON.parse(result.stdout);
        assertStaticCheckResult(value);
        return value;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('static App check verifies Windows x64 and arm64 without native staging on any host', async (context) => {
    for (const native of [
        { platform: 'linux', architecture: 'x64' },
        { platform: 'darwin', architecture: 'arm64' },
    ]) {
        for (const portable of [false, true]) {
            await context.test(
                `${native.platform}/${native.architecture}, ${portable ? 'portable' : 'installed'}`,
                async () => {
                    const result = await staticCheck(native, portable);
                    assert.equal(
                        result.error,
                        null,
                        'The actual CLI must select Windows targets independently of its host.',
                    );
                    const targets = [
                        {
                            schemaVersion: 1,
                            kind: portable ? 'portable' : 'installed',
                            platform: 'win32',
                            architecture: 'x64',
                        },
                        {
                            schemaVersion: 1,
                            kind: portable ? 'portable' : 'installed',
                            platform: 'win32',
                            architecture: 'arm64',
                        },
                    ];
                    assert.deepEqual(result.state.targets, targets);
                    assert.deepEqual(
                        result.state.bundles,
                        targets.flatMap((target) =>
                            [
                                'app-bootstrap.ts',
                                'app-main.ts',
                                'app-preload.ts',
                                'app-renderer.ts',
                                'deployment-worker.ts',
                            ].map((entry) => ({
                                target,
                                entry,
                            })),
                        ),
                    );
                    assert.deepEqual(result.state.effects, {
                        extraction: 0,
                        spawn: 0,
                        dlopen: 0,
                        mkdir: 0,
                        mkdtemp: 0,
                        write: 0,
                        stage: 0,
                    });
                    assert.equal(result.state.officialInputs, 3);
                    assert.equal(result.state.officialFiles, 1);
                    assert.equal(result.state.nativeInputs, 2);
                    assert.equal(result.state.notices, 2);
                    assert.equal(
                        result.state.reads.filter((name) => name.endsWith('app-native-release.json')).length,
                        2,
                    );
                    const message = result.state.logs.join('\n');
                    assert.match(message, /Windows/);
                    assert.match(message, /x64/);
                    assert.match(message, /arm64/);
                    assert.match(message, /bundles/i);
                    assert.match(message, /inputs|loading closure/i);
                    assert.match(message, /licenses/i);
                    assert.match(message, /without writing/i);
                    assert.match(
                        message,
                        /native (?:staging and )?acceptance (?:not performed|not verified|remains pending)/i,
                    );
                },
            );
        }
    }
});

test('matched non-Windows generation metadata refuses before source or build I/O', async (context) => {
    let reads = 0;
    let spawns = 0;
    const spawn = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(spawn);
    const blockedRead = () => {
        reads++;
        throw new Error('Source read preceded distribution refusal.');
    };
    const opened = mock.method(fs, 'open', blockedRead);
    const stated = mock.method(fs, 'lstat', blockedRead);
    const read = mock.method(fs, 'readFile', blockedRead);
    const native = mock.method(process, 'dlopen', () => {
        throw new Error('Unexpected native loading.');
    });
    Object.defineProperty(ChildProcess.prototype, 'spawn', {
        ...spawn,
        value: () => {
            spawns++;
            throw new Error('Unexpected build subprocess.');
        },
    });
    syncBuiltinESMExports();
    try {
        for (const platform of ['linux', 'darwin']) {
            await context.test(platform, async () => {
                reads = 0;
                const options = {
                    root: 'unused',
                    kind: 'portable',
                    platform: 'win32',
                    architecture: 'x64',
                } satisfies Parameters<typeof generateAppFiles>[0];
                assert.equal(Reflect.set(options, 'platform', platform), true);
                assert.equal(Reflect.get(options, 'platform'), platform);
                await assert.rejects(generateAppFiles(options), /Invalid App distribution identity/);
                assert.equal(reads, 0);
                assert.equal(spawns, 0);
                assert.equal(native.mock.callCount(), 0);
            });
        }
    } finally {
        opened.mock.restore();
        stated.mock.restore();
        read.mock.restore();
        Object.defineProperty(ChildProcess.prototype, 'spawn', spawn);
        native.mock.restore();
        syncBuiltinESMExports();
    }
});

test('actual App bundles include all six reviewed SDK vendor notices and exclude unused browser vendor', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files = await generateAppFiles({ root, kind: 'portable', platform: 'win32', architecture: 'x64' });
    const notices = files.get('THIRD-PARTY-NOTICES.txt')?.toString();
    assert.ok(notices);
    for (const identity of [
        'ajv@8.18.0',
        'ajv-formats@3.0.1',
        'content-type@1.0.5',
        'fast-deep-equal@3.1.3',
        'fast-uri@3.1.0',
        'json-schema-traverse@1.0.0',
    ]) {
        assert.equal(notices.split(`${identity} — LICENSE (vendored)`).length - 1, 1, identity);
    }
    assert.doesNotMatch(notices, /@cfworker\/json-schema/);
});

test('App delivery copies every official published file at its complete relative path', async () => {
    const release: unknown = JSON.parse(
        await readFile(new URL('../tooling/official-server-release.json', import.meta.url), 'utf8'),
    );
    assert.ok(isRecord(release) && Array.isArray(release.files));
    const files = await readAppOfficialFiles(fileURLToPath(new URL('..', import.meta.url)));
    for (const record of release.files) {
        assert.ok(isRecord(record) && typeof record.path === 'string');
        const bytes = await readFile(new URL(`../node_modules/chrome-devtools-mcp/${record.path}`, import.meta.url));
        assert.ok(files.get(record.path)?.equals(bytes), record.path);
    }
    assert.equal(files.size, release.files.length);
});

test('compile-free App composition includes an unbound ordinary worker with no delivered query or compiler runtime', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files = await generateAppFiles({ root, kind: 'portable', platform: 'win32', architecture: 'x64' });
    const worker = files.get('deployment-worker.mjs');
    assert.ok(worker && worker.length > 0);
    assert.match(worker.toString('utf8'), /unbound/);
    assert.equal(files.has('windows-deployment-query.exe'), false);
    assert.doesNotMatch(
        worker.toString('utf8'),
        /DctDeploymentCreateProgram|Framework64|dct-deployment-support-|createFreshDeploymentRoot|copyPayload|createGatewayCore/,
    );
});
