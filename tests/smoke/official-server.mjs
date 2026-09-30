import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultControlEndpoint, sendControlRequest } from '../../src/adapters/control-ipc.mjs';
import { createClient } from './mcp-client.mjs';

if (process.platform !== 'win32') throw new Error('This real Chrome smoke is Windows-only.');
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-chrome-smoke-'));
const stopFile = path.join(folder, 'monitor-stop');
const monitor = spawn(
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
);
let monitorOutput = '';
monitor.stdout.on('data', (data) => {
    monitorOutput += data;
});
await new Promise((resolve) => monitor.stdout.once('data', resolve));
const client = createClient(path.join(root, 'plugins/debugging-cdp-targets/dist/mcp-bootstrap.mjs'));
async function control(request) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await sendControlRequest(defaultControlEndpoint(), request);
        if (result.ok) return result.result;
        if (!/busy/.test(result.error)) assert.fail(JSON.stringify(result));
        if (attempt === 0) console.log('Waiting for background CDP requests to finish before disposition.');
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.fail('CDP never became idle for disposition.');
}
const tool = (name, arguments_ = {}) => client.request('tools/call', { name, arguments: arguments_ });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function launch(profile, title) {
    return `"${chrome}" --user-data-dir="${path.join(folder, profile)}" --remote-debugging-port={port} "data:text/html,<title>${title}</title><h1>Isolated smoke</h1>"`;
}
let active = false;
try {
    const initialized = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'isolated-plugin-smoke', version: '0.1.0' },
    });
    client.notify('notifications/initialized');
    console.log(JSON.stringify({ server: initialized.serverInfo }));
    const tools = await client.request('tools/list');
    assert.ok(tools.tools.some((entry) => entry.name === 'list_pages'));
    assert.ok(tools.tools.some((entry) => /extension/.test(entry.name)));
    assert.equal((await control({ action: 'status' })).status, 'none');
    assert.equal((await tool('list_pages')).isError, true);
    const first = await control({
        action: 'start',
        targetKind: 'chrome',
        basePort: 19222,
        launchCommand: launch('profile-one', 'FIRST'),
    });
    active = true;
    console.log(JSON.stringify({ first }));
    const pagesOne = await tool('list_pages');
    assert.notEqual(pagesOne.isError, true, JSON.stringify(pagesOne));
    assert.match(JSON.stringify(pagesOne), /FIRST/);
    const extensions = tools.tools.find((entry) => /list.*extension|extension.*list/.test(entry.name));
    assert.ok(extensions);
    const extensionResult = await tool(extensions.name);
    assert.notEqual(extensionResult.isError, true, JSON.stringify(extensionResult));
    const second = await control({
        action: 'switch',
        targetKind: 'chrome',
        basePort: 19222,
        disposition: 'Close',
        launchCommand: launch('profile-two', 'SECOND'),
    });
    console.log(JSON.stringify({ second }));
    const pagesTwo = await tool('list_pages');
    assert.notEqual(pagesTwo.isError, true, JSON.stringify(pagesTwo));
    assert.match(JSON.stringify(pagesTwo), /SECOND/);
    assert.doesNotMatch(JSON.stringify(pagesTwo), /FIRST/);
    await control({ action: 'stop', disposition: 'Close' });
    active = false;
    assert.equal((await control({ action: 'status' })).status, 'none');
    console.log('Direct official stdio tools, extensions, switch/reconnect, and Close passed.');
} finally {
    if (active) await control({ action: 'stop', disposition: 'Close' }).catch((error) => console.error(error.message));
    await client.close();
    const monitoringEnded = new Promise((resolve) => monitor.once('exit', resolve));
    await writeFile(stopFile, 'stop');
    await monitoringEnded;
    const report = JSON.parse(monitorOutput.trim().split(/\r?\n/).at(-1));
    console.log(JSON.stringify({ windowMonitor: report, testProfileFolder: folder }));
    assert.deepEqual(report.newlyVisibleConsoles, []);
}
