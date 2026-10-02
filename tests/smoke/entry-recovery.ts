import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { controlEndpoint, sendControlRequest } from '../../src/adapters/control-ipc.ts';
import { createPlatformAdapter } from '../../src/adapters/platform-process.ts';
import type { ProcessTarget } from '../../src/domains/cdp-target.ts';
import { parseControlResponse, type TargetStatus } from '../../src/domains/control-contract.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { createClient, readMcpTools } from './mcp-client.ts';

if (process.platform !== 'win32') throw new Error('The real entry recovery smoke is Windows-only.');
const root = fileURLToPath(new URL('../..', import.meta.url));
const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-entry-recovery-'));
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const execute = promisify(execFile);
const platform = createPlatformAdapter();
const forms: { client: number; receivedAt: number; choice: string }[] = [];
const owned: ProcessTarget[] = [];
const clients = Array.from({ length: 4 }, (_, index) =>
    createClient(
        path.join(root, 'plugins/debugging-cdp-targets/dist/mcp-bootstrap.mjs'),
        {},
        async (method, params) => {
            assert.equal(method, 'elicitation/create');
            assert.equal(params.mode, 'form');
            assert.ok(isRecord(params.requestedSchema));
            const choice = index === 0 ? 'restart' : 'cancel';
            forms.push({ client: index, receivedAt: Date.now(), choice });
            return { action: 'accept', content: { action: choice } };
        },
    ),
);
async function tool(index: number, name: string) {
    const client = clients[index];
    assert.ok(client);
    const result = await client.request('tools/call', { name, arguments: {} });
    assert.ok(isRecord(result));
    return result;
}
async function status(entryId: string): Promise<TargetStatus> {
    const response = await sendControlRequest(controlEndpoint(entryId), { action: 'status', entryId });
    assert.ok(response.ok, JSON.stringify(response));
    return response.result;
}
async function cli(action: string, entryId: string, options: string[] = []): Promise<TargetStatus> {
    const { stdout } = await execute(
        process.execPath,
        [path.join(root, 'src/interface/control.ts'), action, '--entry-id', entryId, ...options],
        { windowsHide: true, shell: false, timeout: 60_000 },
    );
    const response = parseControlResponse(JSON.parse(stdout));
    assert.ok(response.ok, JSON.stringify(response));
    return response.result;
}
async function until(predicate: () => Promise<boolean>, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (!(await predicate())) {
        if (Date.now() >= deadline) throw new Error('Expected entry state was not reached.');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
async function recordOwned(target: TargetStatus): Promise<ProcessTarget> {
    assert.ok(target.processId && target.port && target.targetKind);
    const evidence = await platform.snapshot(target.processId, target.port);
    assert.ok(evidence.root.exists);
    assert.equal(path.resolve(evidence.root.executablePath).toLowerCase(), path.resolve(chrome).toLowerCase());
    const fixture = {
        processId: target.processId,
        port: target.port,
        targetKind: target.targetKind,
        executablePath: evidence.root.executablePath,
        startedAtUtc: evidence.root.startedAtUtc,
    };
    owned.push(fixture);
    return fixture;
}
function launch(index: number) {
    return `"${chrome}" --disable-background-mode --user-data-dir="${path.join(folder, `profile-${index}`)}" --remote-debugging-port={port} "data:text/html,<title>ENTRY-${index}</title>"`;
}
async function pages(index: number) {
    const result = await tool(index, 'list_pages');
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result), new RegExp(`ENTRY-${index}`));
}
let ids: string[] = [];
let closeStarted = 0;
let closeCompleted = 0;
try {
    const statuses = await Promise.all(
        clients.map(async (client, index) => {
            await client.request('initialize', {
                protocolVersion: '2025-11-25',
                capabilities: { elicitation: { form: {} } },
                clientInfo: { name: `entry-recovery-${index}`, version: '0.1.0' },
            });
            client.notify('notifications/initialized');
            const catalog = readMcpTools(await client.request('tools/list'));
            assert.ok(catalog.some((item) => item.name === 'list_pages'));
            const result = await tool(index, 'dct_connection_status');
            const parsed = parseControlResponse({ ok: true, result: result.structuredContent });
            assert.ok(parsed.ok);
            assert.equal(parsed.result.status, 'idle');
            return parsed.result;
        }),
    );
    ids = statuses.map((item) => item.entryId);
    assert.equal(new Set(ids).size, 4);
    console.log('Four independent entries initialized.');
    const firstId = ids[0];
    const secondId = ids[1];
    assert.ok(firstId && secondId);
    const [first, second] = await Promise.all(
        [0, 1].map(async (index) => {
            const id = ids[index];
            assert.ok(id);
            return cli('start', id, [
                '--target-kind',
                'chrome',
                '--base-port',
                String(19422 + index * 10),
                '--launch-command',
                launch(index),
            ]);
        }),
    );
    assert.ok(first && second && first.sessionId && second.sessionId);
    const [firstFixture, secondFixture] = await Promise.all([recordOwned(first), recordOwned(second)]);
    console.log('Two isolated targets started.');
    await Promise.all([pages(0), pages(1)]);
    console.log('Both official page tools passed.');
    await cli('stop', firstId, ['--session-id', first.sessionId, '--disposition', 'Keep']);
    await Promise.all([pages(0), pages(1)]);
    const watch = tool(0, 'dct_watch_target');
    await until(async () => (await status(firstId)).taskActive === true);
    console.log('Active watcher confirmed.');
    closeStarted = Date.now();
    assert.equal(await platform.close(firstFixture), true);
    closeCompleted = Date.now();
    const watched = await watch;
    console.log('Active target loss answered.');
    assert.ok(isRecord(watched.structuredContent));
    assert.equal(watched.structuredContent.choice, 'restart');
    const firstForm = forms.find((item) => item.client === 0);
    assert.ok(firstForm);
    assert.ok(
        firstForm.receivedAt - closeCompleted <= 5_000,
        'Protocol form arrived more than five seconds after verified normal closure completed.',
    );
    assert.equal((await status(firstId)).status, 'lost');
    // The test agent explicitly acts on the returned choice; the gateway does not replay work.
    const restarted = await cli('restart', firstId, ['--session-id', first.sessionId]);
    assert.equal(restarted.port, first.port);
    assert.notEqual(restarted.processId, first.processId);
    assert.notEqual(restarted.sessionId, first.sessionId);
    assert.equal(restarted.pageIdsInvalidated, true);
    await recordOwned(restarted);
    await pages(0);
    console.log('Explicit exact-port restart passed.');
    const secondFormsBefore = forms.filter((item) => item.client === 1).length;
    assert.equal(await platform.close(secondFixture), true);
    await until(async () => (await status(secondId)).status === 'lost');
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.equal(forms.filter((item) => item.client === 1).length, secondFormsBefore);
    const idleUse = await tool(1, 'list_pages');
    assert.equal(idleUse.isError, true);
    assert.ok(isRecord(idleUse.structuredContent));
    assert.equal(idleUse.structuredContent.choice, 'cancel');
    assert.equal(forms.filter((item) => item.client === 1).length, secondFormsBefore + 1);
    await cli('stop', secondId, ['--session-id', second.sessionId, '--disposition', 'Close']);
    assert.equal((await status(secondId)).status, 'idle');
    await pages(0);
    console.log('Idle loss and scoped cancellation passed.');
    console.log(
        JSON.stringify({
            passed: true,
            entries: ids,
            protocolFormTiming: {
                closeStarted,
                closeCompleted,
                firstFormReceived: firstForm.receivedAt,
                millisecondsFromCloseStart: firstForm.receivedAt - closeStarted,
                millisecondsFromCloseCompletion: firstForm.receivedAt - closeCompleted,
                measuresUiRendering: false,
            },
            profilesRetainedAt: folder,
        }),
    );
} catch (error) {
    console.error('Recovery smoke primary failure:', error);
    throw error;
} finally {
    // EOF asks each gateway to close its own upstream and fixture target normally.
    const closed = await Promise.allSettled(clients.map((client) => client.close()));
    for (const fixture of owned) {
        const evidence = await platform.snapshot(fixture.processId, fixture.port);
        if (evidence.root.exists) {
            const normallyClosed = await platform.close(fixture, { requireListener: false });
            if (!normallyClosed) console.error('Fixture retained after normal Close:', fixture.processId, fixture.port);
            assert.equal(normallyClosed, true);
        }
    }
    assert.ok(
        closed.every((result) => result.status === 'fulfilled'),
        'Gateway EOF cleanup failed.',
    );
    assert.ok(
        clients.every((client) => client.child.exitCode === 0),
        'Gateway did not exit normally.',
    );
    console.log(
        JSON.stringify({
            gatewayExitCodes: clients.map((client) => client.child.exitCode),
            profilesRetainedAt: folder,
        }),
    );
}
