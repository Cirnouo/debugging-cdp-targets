import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ConnectionStatus, validateIdentity } from '../../src/domains/control-contract.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import {
    createChromeSmokeLaunch,
    inspectChromeSmokeDirectory,
    inspectChromeSmokeTarget,
    requireChromeSmokeExecutable,
} from './chrome-host.ts';
import { closeSmokeConnection, lifecycleClient, readStatus } from './lifecycle-client.ts';
import { createClient, readMcpTools } from './mcp-client.ts';

const chrome = await requireChromeSmokeExecutable();
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-chrome-smoke-')));
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
const client = createClient(path.join(root, 'plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
const tool = async (name: string, arguments_: Record<string, unknown> = {}) => {
    const result = await client.request('tools/call', { name, arguments: arguments_ });
    assert.ok(isRecord(result));
    return result;
};
const control = lifecycleClient(tool);
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
    return createChromeSmokeLaunch(
        chrome,
        path.join(folder, profile),
        `data:text/html,<title>${title}</title><style>h1{color:rgb(12,34,56)}</style><h1>Isolated smoke</h1>`,
    );
}
let entryId: string | undefined;
let active: ConnectionStatus | undefined;
function route(target: ConnectionStatus) {
    assert.ok(target.sessionId);
    return { _dct: { connectionId: target.connectionId, sessionId: target.sessionId } };
}
async function emptyGateway(id: string) {
    const result = await control({ action: 'status', entryId: id });
    assert.ok('connections' in result);
    assert.deepEqual(result.connections, []);
}
try {
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
    entryId = response.entryId;
    validateIdentity(entryId, 'entry ID');
    await emptyGateway(entryId);
    await assert.rejects(() => tool('list_pages'), /routing/);
    const first = await control({
        action: 'start',
        requestId: randomUUID(),
        entryId,
        basePort: 19222,
        ...launch('profile-one', 'FIRST'),
    });
    assert.ok(!('connections' in first) && first.sessionId);
    active = first;
    const firstFixture = await inspectChromeSmokeTarget(first, chrome);
    const firstDirectory = await inspectChromeSmokeDirectory(tool, first, firstFixture);
    managedDirectories.add(firstDirectory);
    console.log(JSON.stringify({ first }));
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
        entryId,
        connectionId: first.connectionId,
        sessionId: first.sessionId,
        disposition: 'Close',
    });
    active = undefined;
    await assert.rejects(lstat(firstDirectory), { code: 'ENOENT' });
    await emptyGateway(entryId);
    const second = await control({
        action: 'start',
        requestId: randomUUID(),
        entryId,
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
        entryId,
        connectionId: second.connectionId,
        sessionId: second.sessionId,
        disposition: 'Close',
    });
    active = undefined;
    await assert.rejects(lstat(secondDirectory), { code: 'ENOENT' });
    await emptyGateway(entryId);
    console.log('Official tools, CSS styles and extensions through a reusable entry, Close, and later start passed.');
} finally {
    if (entryId && active?.sessionId)
        await closeSmokeConnection(control, {
            action: 'stop',
            requestId: randomUUID(),
            entryId,
            connectionId: active.connectionId,
            sessionId: active.sessionId,
            disposition: 'Close',
        }).catch((error: unknown) => console.error(errorMessage(error)));
    await client.close();
    for (const directory of managedDirectories) await assert.rejects(lstat(directory), { code: 'ENOENT' });
    if (monitor) {
        await writeFile(stopFile, 'stop');
        await monitoringEnded;
        const report: unknown = JSON.parse(monitorOutput.trim().split(/\r?\n/).at(-1) ?? 'null');
        assert.ok(isRecord(report));
        console.log(JSON.stringify({ windowMonitor: report, testProfileFolder: folder }));
        assert.deepEqual(report.newlyVisibleConsoles, []);
    } else {
        console.log(JSON.stringify({ testProfileFolder: folder }));
    }
}
