import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, mkdtemp, realpath, rmdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { createOfficialConnection, type OfficialConnection } from '../../src/adapters/mcp-bridge.ts';
import { verifyOfficialPackage } from '../../src/adapters/official-package.ts';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import { createGatewayCore } from '../../src/application/plugin-runtime.ts';
import type { ManagedTarget } from '../../src/gateway/targets/model/target-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { OFFICIAL_RELEASE } from '../../tooling/official-release.ts';
import { requireGuiAuthorization } from '../gui-authorization.ts';
import { createChromeSmokeLaunch, requireChromeSmokeExecutable } from './chrome-host.ts';
import { readChromeSmokeProfile } from './chrome-profile-probe.ts';

const args = requireGuiAuthorization();
if (process.platform !== 'win32')
    throw new Error('This maintained retained-official acceptance currently requires Windows.');
if (args.length !== 1 || !path.isAbsolute(args[0] ?? ''))
    throw new Error('Supply one absolute evidence directory after --allow-gui.');
const evidenceDirectory = path.resolve(args[0] ?? '');
assert.equal(process.versions.electron, undefined, 'Run this direct-core regression with ordinary Node.');
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major === 24 && minor !== undefined && minor >= 21 && !process.version.includes('-'));
const officialDirectory = await realpath(
    fileURLToPath(new URL(`../../node_modules/${OFFICIAL_RELEASE.name}/`, import.meta.url)),
);
await verifyOfficialPackage(officialDirectory, OFFICIAL_RELEASE, { pnpmInstalled: true });
const officialRuntime = Object.freeze({
    nodeExecutable: process.execPath,
    bin: path.join(officialDirectory, OFFICIAL_RELEASE.bin),
});
await mkdir(evidenceDirectory, { recursive: true });
const chrome = await requireChromeSmokeExecutable();
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-retained-official-')));
const profile = path.join(scratch, 'profile');
const execute = promisify(execFile);
const owned: ManagedTarget[] = [];
const officials: OfficialConnection[] = [];
const officialExits = new Set<number>();
const requests: string[] = [];
const steps: Record<string, unknown>[] = [];
let generation = 1;
let failure: unknown;
let cleanupSucceeded = false;
async function stage<T>(name: string, action: () => Promise<T>): Promise<T> {
    async function record(outcome: string) {
        const event = { stage: name, outcome, generation, at: new Date().toISOString() };
        console.log(JSON.stringify(event));
        await appendFile(path.join(evidenceDirectory, 'stages.ndjson'), `${JSON.stringify(event)}\n`, 'utf8');
    }
    await record('started');
    try {
        const result = await action();
        await record('succeeded');
        return result;
    } catch (error) {
        await record('failed');
        throw error;
    }
}
const server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(url);
    response.setHeader('cache-control', 'no-store');
    if (url.startsWith('/probe?')) {
        response.setHeader('content-type', 'application/json');
        const body = JSON.stringify({ synthetic: true, generation });
        response.setHeader('content-length', Buffer.byteLength(body));
        response.end(body);
    } else if (url === '/favicon.ico') {
        response.writeHead(204);
        response.end();
    } else {
        response.setHeader('content-type', 'text/html');
        response.end(
            '<!doctype html><title>Owned retained official fixture</title><button onclick="window.syntheticClicks=(window.syntheticClicks||0)+1">Synthetic action</button>',
        );
    }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;

async function occupancy(directory: string) {
    const script = [
        '$rows = @(Get-CimInstance Win32_Process -Filter "name=\'chrome.exe\'");',
        '$roots = @($rows | Where-Object { $_.CommandLine -notmatch "--type=" });',
        'foreach ($r in $roots) {',
        ' if (!$r.ExecutablePath -or !$r.CommandLine) { throw "Unverifiable related application" };',
        ' $owned = @([int]$r.ProcessId);',
        ' do { $old = $owned.Count; foreach ($p in $rows) { if (($owned -contains [int]$p.ParentProcessId) -and ($owned -notcontains [int]$p.ProcessId)) { $owned += [int]$p.ProcessId } } } while ($owned.Count -ne $old);',
        ' $dirs = @($rows | Where-Object { $owned -contains [int]$_.ProcessId } | ForEach-Object { if ($_.CommandLine -match \'--user-data-dir(?:=|\\s+)(?:"([^"\\r\\n]+)"|([^\\s"]+))\') { if ($Matches[1]) { $Matches[1] } else { $Matches[2] } } } | Select-Object -Unique);',
        ' if ($dirs.Count -ne 1) { throw "Related effective root is unverifiable" };',
        ' if ([IO.Path]::GetFullPath($dirs[0]).TrimEnd("\\") -ieq [IO.Path]::GetFullPath($env:DCT_RETAINED_SMOKE_ROOT).TrimEnd("\\")) { throw "Owned fixture root is occupied" };',
        '};',
        'Write-Output $roots.Count;',
    ].join('\n');
    const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        shell: false,
        env: { ...process.env, DCT_RETAINED_SMOKE_ROOT: directory },
    });
    steps.push({ stage: 'occupancy', relatedRoots: Number(result.stdout.trim()), generation });
}

function validateCalls(tools: Tool[]) {
    const planned: [string, Record<string, unknown>][] = [
        ['list_pages', {}],
        ['take_snapshot', { pageId: 1 }],
        ['click', { pageId: 1, uid: '1_1' }],
        ['evaluate_script', { pageId: 1, function: '() => true', waitForStableDom: false }],
        ['list_network_requests', { pageId: 1, resourceTypes: ['fetch'] }],
        ['get_network_request', { pageId: 1, reqid: 1 }],
        ['select_page', { pageId: 1 }],
    ];
    for (const [name, arguments_] of planned) {
        const tool = tools.find((tool) => tool.name === name);
        assert.ok(tool, `Missing actual official tool ${name}.`);
        for (const field of tool.inputSchema.required ?? [])
            assert.ok(Object.hasOwn(arguments_, field), `${name} requires ${field}.`);
        for (const [field, value] of Object.entries(arguments_)) {
            const schema: unknown = tool.inputSchema.properties?.[field];
            assert.ok(isRecord(schema), `${name}.${field} must exist in the actual schema.`);
            if (schema.type === 'number' || schema.type === 'string' || schema.type === 'boolean')
                assert.equal(typeof value, schema.type);
        }
        if (name === 'evaluate_script')
            assert.equal(
                typeof arguments_.pageId,
                'number',
                'Page evaluation requires pageId even in the page/service-worker union.',
            );
    }
    steps.push({ stage: 'offline-plan-validation', tools: planned.map(([name]) => name), actualCatalog: true });
}
function text(result: CallToolResult) {
    return result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
}
const host = createTargetHost();
const core = await createGatewayCore({
    officialRuntime,
    createHost: () => ({
        ...host,
        launch: async (options, context) => {
            assert.ok(context?.dataDirectory);
            await occupancy(context.dataDirectory);
            const target = await stage('native-launch', () => host.launch(options, context));
            owned.push(target);
            assert.equal(
                await realpath(path.dirname(await stage('profile-observation', () => readChromeSmokeProfile(target)))),
                await realpath(context.dataDirectory),
            );
            return target;
        },
    }),
    createConnection: async (url, options) => {
        const connection = await stage('official-acquisition', () => createOfficialConnection(url, options));
        officials.push(connection);
        connection.onExit(() => {
            if (connection.processId !== undefined) officialExits.add(connection.processId);
        });
        return connection;
    },
}).catch(async (error: unknown) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rmdir(scratch);
    throw error;
});
const registration = core.register();
const client = core.attachClient(registration.bearer);
let roots = [{ uri: pathToFileURL(scratch).href }];
const context = () =>
    client.request({
        requestId: 0,
        capabilities: { roots: true, formElicitation: false },
        readRoots: async () => ({ roots }),
        waitSignal: AbortSignal.timeout(60_000),
    });
try {
    validateCalls(officials[0]?.tools ?? []);
    const first = await stage('connection-start', () =>
        core.controller.start(createChromeSmokeLaunch(chrome, profile, fixtureUrl), { client: context() }),
    );
    assert.ok(first.sessionId);
    const firstRoute = { connectionId: first.connectionId, sessionId: first.sessionId };
    let route = firstRoute;
    async function call(name: string, arguments_: Record<string, unknown> = {}, expectedError = false) {
        const result = await stage(`official:${name}`, () =>
            core.invoke(name, { ...arguments_, _dct: route }, context()),
        );
        assert.equal(result.isError === true, expectedError, `${name}: ${text(result)}`);
        return text(result);
    }
    async function page() {
        const pages = await call('list_pages');
        const id = pages
            .split('\n')
            .find((line) => line.includes(fixtureUrl))
            ?.match(/^(\d+):/)?.[1];
        assert.ok(id, 'Fresh list_pages must contain the owned synthetic page.');
        return Number(id);
    }
    async function state(pageId: number, epoch: number) {
        const snapshot = await call('take_snapshot', { pageId });
        const uid = snapshot.match(/uid=([^\s]+) button "Synthetic action"/)?.[1];
        assert.ok(uid);
        await call('click', { pageId, uid });
        const evaluated = await call('evaluate_script', {
            pageId,
            function: `async () => { const response = await fetch('/probe?generation=${epoch}'); const body = JSON.parse(await response.text()); if (!body.synthetic || body.generation !== ${epoch}) throw new Error('Incomplete synthetic body'); return window.syntheticClicks; }`,
            waitForStableDom: false,
        });
        assert.match(evaluated, /1/);
        const network = await call('list_network_requests', { pageId, resourceTypes: ['fetch'] });
        const request = network
            .split('\n')
            .find((line) => line.includes(`${fixtureUrl.replace('/fixture', '')}/probe?generation=${epoch} `));
        assert.ok(request);
        assert.match(request, /\[200\]/);
        const reqid = request.match(/reqid=(\d+)/)?.[1];
        assert.ok(reqid);
        steps.push({
            stage: 'synthetic-state',
            pageId,
            uid,
            reqid: Number(reqid),
            epoch,
            responseBodyConsumed: true,
            networkStatus: 200,
        });
        return { pageId, uid, reqid: Number(reqid) };
    }
    const old = await state(await page(), 1);
    const official = officials[1];
    assert.ok(official?.processId);
    roots = [{ uri: 'file:///changed-client-roots' }];
    generation = 2;
    const next = await stage('target-only-restart', () => core.controller.restart({ ...firstRoute, scope: 'target' }));
    assert.ok(next.sessionId);
    route = { connectionId: next.connectionId, sessionId: next.sessionId };
    assert.equal(officials.length, 2, 'Target-only restart must retain the actual official child/transport.');
    assert.equal(officialExits.has(official.processId), false);
    assert.notEqual(
        `${owned[0]?.processId}/${owned[0]?.startedAtUtc}`,
        `${owned[1]?.processId}/${owned[1]?.startedAtUtc}`,
    );
    const fresh = await page();
    assert.notEqual(fresh, old.pageId);
    steps.push({
        stage: 'retained-native-reconnect',
        officialPid: official.processId,
        officialTransportRetained: true,
        oldPageId: old.pageId,
        freshPageId: fresh,
        targetGenerationChanged: true,
    });
    await assert.rejects(core.invoke('list_pages', { _dct: firstRoute }, context()), /stale/);
    await call('select_page', { pageId: old.pageId }, true);
    await call('get_network_request', { pageId: old.pageId, reqid: old.reqid }, true);
    await call('click', { pageId: fresh, uid: old.uid }, true);
    const current = await state(fresh, 2);
    await call('get_network_request', { pageId: current.pageId, reqid: current.reqid });
    const configuration = await core.control(
        { action: 'status', connectionId: next.connectionId, include: ['configuration'] },
        context(),
    );
    assert.deepEqual(configuration.roots, { roots: [{ uri: pathToFileURL(scratch).href }] });
    assert.deepEqual(
        requests.filter((url) => url.startsWith('/probe?')),
        ['/probe?generation=1', '/probe?generation=2'],
    );
    steps.push({
        stage: 'retained-reconnect',
        officialPid: official.processId,
        officialTransportRetained: true,
        old,
        current,
        oldRouteRejected: true,
        oldPageAndSnapshotRejected: true,
        oldNetworkPairRejected: true,
        bareRequestIdMayReuse: old.reqid === current.reqid,
        rootsRetained: true,
        syntheticRequestsNotReplayed: true,
    });
} catch (error) {
    failure = error;
} finally {
    try {
        await stage('normal-final-cleanup', () => core.cleanup());
        assert.equal(core.admin.cleanupState(), 'closed');
        await assert.rejects(lstat(profile), { code: 'ENOENT' });
        for (const target of owned) {
            await target.waitForExit?.();
            await target.child?.waitForResourcesClosed?.();
        }
        for (const official of officials)
            if (official.processId !== undefined) assert.ok(officialExits.has(official.processId));
        await rmdir(scratch);
        cleanupSucceeded = true;
    } catch (error) {
        failure = failure ? new AggregateError([failure, error], 'Acceptance and normal cleanup failed.') : error;
    }
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await writeFile(
        path.join(evidenceDirectory, 'result.json'),
        `${JSON.stringify({ outcome: failure ? 'failed' : 'passed', node: process.version, platform: process.platform, owned: owned.map((target) => ({ pid: target.processId, startedAtUtc: target.startedAtUtc, port: target.port })), steps, cleanupSucceeded, ...(failure ? { error: failure instanceof Error ? failure.message : String(failure), retainedScratch: cleanupSucceeded ? undefined : scratch } : {}) }, null, 4)}\n`,
        'utf8',
    );
}
if (failure) throw failure;
console.log(JSON.stringify({ outcome: 'passed', evidenceDirectory, cleanupSucceeded }));
