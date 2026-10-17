import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client';
import type { ConnectionStatus } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { requireGuiAuthorization } from '../gui-authorization.ts';
import {
    createChromeSmokeLaunch,
    inspectChromeSmokeDirectory,
    inspectChromeSmokeTarget,
    requireChromeSmokeExecutable,
} from './chrome-host.ts';
import {
    type BrowserStartupRecord,
    checkChromeSmokeDisplay,
    createChromeStartupCapture,
    validateBrowserStartupRecord,
} from './chrome-startup.ts';
import {
    createFixtureArtifacts,
    createFixtureGatewayClient,
    createSmokeFailures,
    fixtureOutputCollectionId,
    fixtureOutputDirectory,
} from './fixture-artifacts.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { readMcpTools } from './mcp-client.ts';

const authorizedArgs = requireGuiAuthorization();
const args: string[] = [];
let startupStudy = false;
let chromeFileLogging: 'on' | 'off' | undefined;
for (let index = 0; index < authorizedArgs.length; index++) {
    const argument = authorizedArgs[index];
    if (argument === '--startup-study') {
        if (startupStudy) throw new Error('Duplicate --startup-study.');
        startupStudy = true;
    } else if (argument === '--chrome-file-logging') {
        if (chromeFileLogging !== undefined) throw new Error('Duplicate --chrome-file-logging.');
        const arm = authorizedArgs[++index];
        if (arm !== 'on' && arm !== 'off') throw new Error('Expected --chrome-file-logging on|off.');
        chromeFileLogging = arm;
    } else if (argument !== undefined) args.push(argument);
}
if (startupStudy !== (chromeFileLogging !== undefined))
    throw new Error('Startup study requires both --startup-study and explicit --chrome-file-logging on|off.');
if (startupStudy && process.platform !== 'linux') throw new Error('Startup study requires Linux.');
const outputDirectory = fixtureOutputDirectory(args);
const artifacts = createFixtureArtifacts(outputDirectory, 'official-server', {
    collectionId: fixtureOutputCollectionId(args),
});
const failures = createSmokeFailures(artifacts);
const currentCollection = artifacts.snapshot();
const controlledDiagnostics =
    !!outputDirectory && currentCollection.collectionId !== null && !currentCollection.collectionRejected;
if (startupStudy && (!controlledDiagnostics || currentCollection.collectionId !== fixtureOutputCollectionId(args))) {
    const error = new Error('Startup study requires a current accepted diagnostics collection.');
    failures.primary(error, 'prerequisites');
    failures.finish();
}
if (startupStudy)
    console.log(
        JSON.stringify({
            startupStudy: { chromeFileLogging, launch: 1, expectedLogAbsence: chromeFileLogging === 'off' },
        }),
    );
function startupEvidence(record: Readonly<BrowserStartupRecord>, firstSample = true) {
    const safe = validateBrowserStartupRecord(record);
    if (!safe) return;
    try {
        artifacts.startup(safe);
        if (firstSample) console.log(JSON.stringify(safe));
    } catch {}
}
artifacts.begin('prerequisites');
const chrome = await requireChromeSmokeExecutable().catch((error: unknown) => {
    failures.primary(error, 'prerequisites');
    failures.finish();
    throw error;
});
const display = await checkChromeSmokeDisplay(controlledDiagnostics);
if (display) {
    startupEvidence(display);
    try {
        assert.ok(!display.available || display.responsive, 'Controlled Chrome X display is not responsive.');
    } catch (error) {
        failures.primary(error, 'prerequisites');
        failures.finish();
        throw error;
    }
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-chrome-smoke-')));
const startup = await createChromeStartupCapture(controlledDiagnostics, folder, startupEvidence);
const managedDirectories = new Set<string>();
const stopFile = path.join(folder, 'monitor-stop');
const monitor =
    process.platform === 'win32'
        ? spawn(
              'powershell.exe',
              [
                  '-NoProfile',
                  '-NonInteractive',
                  '-ExecutionPolicy',
                  'Bypass',
                  '-File',
                  fileURLToPath(new URL('./windows-monitor.ps1', import.meta.url)),
                  '-StopFile',
                  stopFile,
              ],
              { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
          )
        : undefined;
const monitoringEnded = monitor ? new Promise<void>((resolve) => monitor.once('close', () => resolve())) : undefined;
let monitorOutput = '';
monitor?.stdout.on('data', (data) => {
    monitorOutput += data;
});
if (monitor)
    await new Promise<void>((resolve, reject) => {
        monitor.stdout.once('data', () => resolve());
        monitor.once('error', reject);
    });
const client = createFixtureGatewayClient(
    path.join(root, 'tests/fixtures/http-gateway.ts'),
    outputDirectory,
    'official-server',
    artifacts,
);
const tool = async (name: string, arguments_: Record<string, unknown> = {}) => {
    const result = await client.request('tools/call', { name, arguments: arguments_ });
    assert.ok(isRecord(result));
    return result;
};
const executeControl = lifecycleClient(tool);
const control: typeof executeControl = (request) =>
    startup && (request.action === 'start' || request.action === 'restart')
        ? startup.settled(
              () => executeControl(request),
              request.action === 'restart',
              request.action === 'start'
                  ? request.launch.args?.find((arg) => arg.startsWith('--log-file='))?.slice('--log-file='.length)
                  : undefined,
          )
        : executeControl(request);
function textContent(result: Record<string, unknown>) {
    assert.ok(Array.isArray(result.content));
    return result.content
        .map((block: unknown) => {
            assert.ok(isRecord(block) && block.type === 'text' && typeof block.text === 'string');
            return block.text;
        })
        .join('\n');
}
function launch(profile: string, title: string) {
    const startupLog = startup?.newLog();
    return createChromeSmokeLaunch(
        chrome,
        path.join(folder, profile),
        `data:text/html,<title>${title}</title><style>h1{color:rgb(12,34,56)}</style><h1>Isolated smoke</h1>`,
        process.platform,
        chromeFileLogging === 'off' ? undefined : startupLog,
    );
}
let active: ConnectionStatus | undefined;
function route(target: ConnectionStatus) {
    assert.ok(target.sessionId);
    return { _dct: { connectionId: target.connectionId, sessionId: target.sessionId } };
}
async function emptyGateway() {
    const result = await control({ action: 'status' });
    assert.ok('connections' in result);
    assert.deepEqual(result.connections, []);
}
try {
    artifacts.begin('acceptance');
    const initialized = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'isolated-plugin-smoke', version: '0.1.0' },
    });
    client.notify('notifications/initialized');
    assert.ok(isRecord(initialized));
    console.log(JSON.stringify({ server: initialized.serverInfo }));
    const tools = readMcpTools(await client.request('tools/list'));
    assert.ok(tools.some((entry) => entry.name === 'list_pages'));
    assert.ok(tools.some((entry) => entry.name === 'get_css_styles'));
    assert.ok(tools.some((entry) => /extension/.test(entry.name)));
    const statusTool = await tool('dct_connection_status');
    const response = readStatus(statusTool.structuredContent);
    assert.ok('connections' in response);
    await emptyGateway();
    await assert.rejects(
        () => tool('list_pages'),
        (error: unknown) => error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams,
    );
    const first = await control({
        action: 'start',
        requestId: randomUUID(),
        basePort: 19222,
        ...launch('profile-one', 'FIRST'),
    });
    assert.ok(!('connections' in first) && first.sessionId);
    active = first;
    const firstFixture = await inspectChromeSmokeTarget(first, chrome);
    const firstDirectory = await inspectChromeSmokeDirectory(tool, first, firstFixture);
    managedDirectories.add(firstDirectory);
    console.log(JSON.stringify({ first }));
    if (!startupStudy) {
        const pagesOne = await tool('list_pages', route(first));
        assert.notEqual(pagesOne.isError, true, JSON.stringify(pagesOne));
        assert.match(JSON.stringify(pagesOne), /FIRST/);
        const page = textContent(pagesOne).match(/^(\d+):.*FIRST/m);
        assert.ok(page?.[1], 'The isolated page must have an official page ID.');
        const pageId = Number(page[1]);
        const snapshot = await tool('take_snapshot', { ...route(first), pageId });
        assert.notEqual(snapshot.isError, true, JSON.stringify(snapshot));
        const heading = textContent(snapshot).match(/uid=(\S+) heading "Isolated smoke"/);
        assert.ok(heading?.[1], 'The isolated heading must have an official snapshot UID.');
        const styles = await tool('get_css_styles', { ...route(first), pageId, uid: heading[1] });
        assert.notEqual(styles.isError, true, JSON.stringify(styles));
        assert.match(textContent(styles), /color:\s*rgb\(12,\s*34,\s*56\)/);
        const extensions = tools.find((entry) => /list.*extension|extension.*list/.test(entry.name));
        assert.ok(extensions);
        const extensionResult = await tool(extensions.name, route(first));
        assert.notEqual(extensionResult.isError, true, JSON.stringify(extensionResult));
        await closeSmokeConnection(control, {
            action: 'stop',
            requestId: randomUUID(),
            connectionId: first.connectionId,
            sessionId: first.sessionId,
            disposition: 'Close',
        });
        active = undefined;
        await assert.rejects(lstat(firstDirectory), { code: 'ENOENT' });
        await emptyGateway();
        const second = await control({
            action: 'start',
            requestId: randomUUID(),
            basePort: 19222,
            ...launch('profile-two', 'SECOND'),
        });
        assert.ok(!('connections' in second) && second.sessionId);
        assert.notEqual(second.connectionId, first.connectionId);
        assert.notEqual(second.sessionId, first.sessionId);
        active = second;
        const secondFixture = await inspectChromeSmokeTarget(second, chrome);
        const secondDirectory = await inspectChromeSmokeDirectory(tool, second, secondFixture);
        managedDirectories.add(secondDirectory);
        console.log(JSON.stringify({ second }));
        const pagesTwo = await tool('list_pages', route(second));
        assert.notEqual(pagesTwo.isError, true, JSON.stringify(pagesTwo));
        assert.match(JSON.stringify(pagesTwo), /SECOND/);
        assert.doesNotMatch(JSON.stringify(pagesTwo), /FIRST/);
        await closeSmokeConnection(control, {
            action: 'stop',
            requestId: randomUUID(),
            connectionId: second.connectionId,
            sessionId: second.sessionId,
            disposition: 'Close',
        });
        active = undefined;
        await assert.rejects(lstat(secondDirectory), { code: 'ENOENT' });
        await emptyGateway();
        console.log(
            'Official tools, CSS styles and extensions through a reusable entry, Close, and later start passed.',
        );
    }
} catch (error) {
    failures.primary(error);
} finally {
    if (active?.sessionId) {
        const { connectionId, sessionId } = active;
        await failures.cleanup('target-cleanup', () =>
            closeSmokeConnection(control, {
                action: 'stop',
                requestId: randomUUID(),
                connectionId,
                sessionId,
                disposition: 'Close',
            }),
        );
    }
    await failures.cleanup('gateway-close', async () => {
        await client.close();
        if (startupStudy) assert.equal(client.child.exitCode, 0, 'The study gateway must exit normally.');
    });
    for (const directory of managedDirectories)
        await failures.cleanup('profile-cleanup', () => assert.rejects(lstat(directory), { code: 'ENOENT' }));
    if (monitor) {
        await failures.cleanup('window-monitor', async () => {
            await writeFile(stopFile, 'stop');
            await monitoringEnded;
            const report: unknown = JSON.parse(monitorOutput.trim().split(/\r?\n/).at(-1) ?? 'null');
            assert.ok(isRecord(report));
            console.log(JSON.stringify({ windowMonitor: report, testProfileFolder: folder }));
            assert.deepEqual(report.newlyVisibleConsoles, []);
        });
    } else {
        console.log(JSON.stringify({ testProfileFolder: folder }));
    }
    await startup?.close(!failures.hasFailure() && client.child.exitCode === 0);
    if (startupStudy)
        console.log(
            JSON.stringify({
                startupStudyResult: {
                    kind: 'single-launch study',
                    chromeFileLogging,
                    expectedLogAbsence: chromeFileLogging === 'off',
                    result: failures.hasFailure() ? 'failed' : 'passed',
                },
            }),
        );
    failures.finish();
}
