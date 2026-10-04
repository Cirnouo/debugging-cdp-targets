import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { assertSummary, hookEvents, hookMarker } from '../fixtures/hook-gateway-events.ts';
import { createStdioClient } from './mcp-client.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executable = process.argv[2] ?? 'codex';
const scenarios = ['untrusted', 'pre', 'post', 'stop', 'idle', 'inactive', 'lifecycle'] as const;
type Mode = (typeof scenarios)[number];

function texts(request: Record<string, unknown>): string[] {
    assert.ok(Array.isArray(request.input));
    return request.input.flatMap((item: unknown) => {
        if (!isRecord(item) || !['developer', 'user'].includes(String(item.role)) || !Array.isArray(item.content))
            return [];
        return item.content.flatMap((part: unknown) =>
            isRecord(part) && typeof part.text === 'string' ? [part.text] : [],
        );
    });
}

function toolRoute(value: unknown, name: string, namespace?: string): { name: string; namespace?: string } | undefined {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = toolRoute(item, name, namespace);
            if (found) return found;
        }
    } else if (isRecord(value)) {
        if (value.type === 'namespace' && typeof value.name === 'string')
            return toolRoute(value.tools, name, value.name);
        if (typeof value.name === 'string' && (value.name === name || value.name.endsWith(`__${name}`)))
            return { name: value.name, ...(namespace ? { namespace } : {}) };
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') {
                const found = toolRoute(child, name, namespace);
                if (found) return found;
            }
        }
    }
    return undefined;
}

async function scenario(mode: Mode) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-codex-hooks-'));
    const home = path.join(temporary, 'home');
    const workspace = path.join(temporary, 'workspace');
    const pluginRoot = path.join(temporary, 'marketplace/plugins/codex/debugging-cdp-targets');
    const statePath = path.join(temporary, 'target.json');
    await Promise.all([
        mkdir(home),
        mkdir(workspace),
        mkdir(path.join(pluginRoot, 'hooks'), { recursive: true }),
        mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true }),
        mkdir(path.join(temporary, 'marketplace/.agents/plugins'), { recursive: true }),
    ]);
    const requests: Record<string, unknown>[] = [];
    const calls: string[] = [];
    let failure: unknown;
    let state: Record<string, unknown> | undefined;
    let operationId: string | undefined;
    const model = createServer(async (request, response) => {
        try {
            assert.equal(request.url, '/v1/responses');
            let body = '';
            for await (const chunk of request) body += chunk;
            const value: unknown = JSON.parse(body);
            assert.ok(isRecord(value));
            requests.push(value);
            assert.ok(requests.length <= 6, 'Hook must not create an infinite continuation.');
            const index = requests.length;
            let item: Record<string, unknown>;
            if (index === 1) {
                calls.push('tool_search');
                item = {
                    type: 'tool_search_call',
                    call_id: 'discover-cdp',
                    execution: 'client',
                    arguments: {
                        query:
                            mode === 'lifecycle'
                                ? 'dct_connection_start dct_connection_status dct_operation_wait dct_connection_restart dct_connection_stop dct_connection_end_task dct_operation_cancel'
                                : 'dct_connection_status list_pages dct_connection_end_task',
                        limit: 20,
                    },
                };
            } else if (index <= 3) {
                const name =
                    index === 2
                        ? 'dct_connection_status'
                        : mode === 'lifecycle'
                          ? 'dct_connection_start'
                          : mode === 'inactive'
                            ? 'dct_connection_end_task'
                            : 'list_pages';
                if (index === 3) {
                    assert.ok(Array.isArray(value.input));
                    const output = value.input.find(
                        (entry: unknown) =>
                            isRecord(entry) && entry.type === 'function_call_output' && entry.call_id === 'call-2',
                    );
                    assert.ok(isRecord(output) && typeof output.output === 'string');
                    const status: unknown = JSON.parse(output.output.slice(output.output.indexOf('{')));
                    assert.ok(isRecord(status) && Array.isArray(status.connections) && isRecord(status.connections[0]));
                    assertSummary(status);
                    const actual: unknown = JSON.parse(
                        await readFile(`${statePath}.${String(status.connections[0].connectionId)}`, 'utf8'),
                    );
                    assert.ok(isRecord(actual));
                    state = actual;
                    if (mode === 'pre') await fetch(String(state.signalUrl), { method: 'POST' });
                }
                const route = toolRoute(value.tools, name) ?? toolRoute(value.input, name);
                assert.ok(
                    route,
                    `Codex model tool catalog missing ${name}: ${JSON.stringify(value.input).slice(-4000)}`,
                );
                calls.push(name);
                item = {
                    type: 'function_call',
                    call_id: `call-${index}`,
                    ...route,
                    arguments: JSON.stringify(
                        index === 2
                            ? {}
                            : mode === 'lifecycle'
                              ? {
                                    entryId: state?.entryId,
                                    requestId: 'codex-start',
                                    launch: {
                                        executable: 'fake target',
                                        args: [],
                                        env: { DCT_FIXTURE: 'HOOK_PRIVATE_APP_ARGUMENTS' },
                                    },
                                    mcpArgs: ['--workspace', workspace],
                                }
                              : mode === 'inactive'
                                ? {
                                      entryId: state?.entryId,
                                      connectionId: state?.connectionId,
                                      sessionId: state?.sessionId,
                                      requestId: 'codex-end-task',
                                  }
                                : { _dct: { connectionId: state?.connectionId, sessionId: state?.sessionId } },
                    ),
                };
            } else if (mode === 'lifecycle' && index === 4) {
                assert.ok(Array.isArray(value.input));
                const output = value.input.find(
                    (entry: unknown) =>
                        isRecord(entry) && entry.type === 'function_call_output' && entry.call_id === 'call-3',
                );
                assert.ok(isRecord(output) && typeof output.output === 'string');
                const accepted: unknown = JSON.parse(output.output.slice(output.output.indexOf('{')));
                assert.ok(isRecord(accepted) && typeof accepted.operationId === 'string');
                operationId = accepted.operationId;
                assert.ok(typeof state?.releaseUrl === 'string');
                assert.equal((await fetch(state.releaseUrl, { method: 'POST' })).status, 200);
                const route =
                    toolRoute(value.tools, 'dct_operation_wait') ?? toolRoute(value.input, 'dct_operation_wait');
                assert.ok(route);
                calls.push('dct_operation_wait');
                item = {
                    type: 'function_call',
                    call_id: 'call-4',
                    ...route,
                    arguments: JSON.stringify({
                        entryId: state?.entryId,
                        operationId: accepted.operationId,
                        cursor: 0,
                    }),
                };
            } else {
                if ((mode === 'stop' || mode === 'inactive') && index === 4) {
                    assert.equal(typeof state?.signalUrl, 'string');
                    await fetch(String(state?.signalUrl), { method: 'POST' });
                }
                item = {
                    type: 'message',
                    role: 'assistant',
                    id: `message-${index}`,
                    content: [{ type: 'output_text', text: 'Fixture completed.' }],
                };
            }
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            const events = [
                { type: 'response.created', response: { id: `response-${index}` } },
                { type: 'response.output_item.done', item },
                {
                    type: 'response.completed',
                    response: {
                        id: `response-${index}`,
                        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
                    },
                },
            ];
            response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
        } catch (error) {
            failure = error;
            response.writeHead(500);
            response.end(String(error));
        }
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    const address = model.address();
    assert.ok(address && typeof address !== 'string');
    const environment = { ...process.env, CODEX_HOME: home };
    function codex(args: string[]) {
        const result = spawnSync(executable, args, {
            cwd: workspace,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
            shell: false,
            timeout: 60_000,
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, result.stderr);
    }
    let app: ReturnType<typeof createStdioClient> | undefined;
    try {
        await writeFile(
            path.join(home, 'config.toml'),
            `model = "gpt-5.5"\nmodel_provider = "dct-local"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[features]\nplugins = true\nhooks = true\n[model_providers.dct-local]\nname = "Local Hook test"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`,
        );
        await writeFile(
            path.join(pluginRoot, '.codex-plugin/plugin.json'),
            await readFile(path.join(root, 'plugins/codex/debugging-cdp-targets/.codex-plugin/plugin.json')),
        );
        await writeFile(
            path.join(pluginRoot, 'hooks/hooks.json'),
            await readFile(path.join(root, 'plugins/codex/debugging-cdp-targets/hooks/hooks.json')),
        );
        await writeFile(
            path.join(pluginRoot, 'mcp.json'),
            JSON.stringify({
                mcpServers: {
                    'cdp-targets': {
                        type: 'stdio',
                        default_tools_approval_mode: 'approve',
                        command: process.execPath,
                        args: [path.join(root, 'tests/fixtures/hook-gateway.ts')],
                        cwd: root,
                        env: {
                            DCT_HOOK_FIXTURE_STATE: statePath,
                            DCT_HOOK_FIXTURE_EXIT: mode === 'untrusted' ? 'post' : mode,
                        },
                    },
                },
            }),
        );
        await writeFile(
            path.join(temporary, 'marketplace/.agents/plugins/marketplace.json'),
            JSON.stringify({
                name: 'dct-hook-test',
                plugins: [
                    {
                        name: 'debugging-cdp-targets',
                        source: { source: 'local', path: './plugins/codex/debugging-cdp-targets' },
                    },
                ],
            }),
        );
        codex(['plugin', 'marketplace', 'add', path.join(temporary, 'marketplace'), '--json']);
        codex(['plugin', 'add', 'debugging-cdp-targets@dct-hook-test', '--json']);
        const completed: Record<string, unknown>[] = [];
        const hookNotifications: unknown[] = [];
        const toolCompletions: Record<string, unknown>[] = [];
        let wake: (() => void) | undefined;
        app = createStdioClient(
            executable,
            ['app-server', '--listen', 'stdio://'],
            { cwd: workspace, env: environment },
            undefined,
            (method, params) => {
                if (/hook/i.test(method)) hookNotifications.push({ method, params });
                if (method === 'item/completed' && isRecord(params.item) && params.item.type === 'mcpToolCall')
                    toolCompletions.push(params.item);
                if (method === 'turn/completed') {
                    completed.push(params);
                    wake?.();
                }
            },
        );
        await app.request('initialize', {
            clientInfo: { name: 'isolated-cdp-hooks', version: '0.1.0' },
            capabilities: { experimentalApi: true },
        });
        app.notify('initialized');
        const listed = await app.request('hooks/list', { cwds: [workspace] });
        assert.ok(isRecord(listed) && Array.isArray(listed.data));
        const hooks = listed.data.flatMap((entry: unknown) =>
            isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks : [],
        );
        assert.equal(hooks.length, 4, JSON.stringify(listed));
        assert.ok(hooks.every((hook: unknown) => isRecord(hook) && hook.trustStatus === 'untrusted'));
        if (mode !== 'untrusted') {
            const trusts: Record<string, unknown> = {};
            for (const hook of hooks) {
                assert.ok(isRecord(hook) && typeof hook.key === 'string');
                trusts[hook.key] = { trusted_hash: hook.currentHash };
            }
            await app.request('config/batchWrite', {
                edits: [{ keyPath: 'hooks.state', value: trusts, mergeStrategy: 'upsert' }],
                reloadUserConfig: true,
            });
            const verified = await app.request('hooks/list', { cwds: [workspace] });
            assert.ok(isRecord(verified) && Array.isArray(verified.data));
            const reviewed = verified.data.flatMap((entry: unknown) =>
                isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks : [],
            );
            assert.equal(reviewed.length, 4);
            assert.ok(
                reviewed.every(
                    (hook: unknown) => isRecord(hook) && hook.trustStatus === 'trusted' && hook.enabled === true,
                ),
                JSON.stringify(verified),
            );
        }
        const started = await app.request('thread/start', {
            cwd: workspace,
            model: 'gpt-5.5',
            modelProvider: 'dct-local',
            approvalPolicy: 'never',
            sandbox: 'read-only',
            ephemeral: true,
        });
        assert.ok(isRecord(started) && isRecord(started.thread) && typeof started.thread.id === 'string');
        const threadId = started.thread.id;
        const servers = await app.request('mcpServerStatus/list');
        assert.ok(isRecord(servers) && Array.isArray(servers.data), JSON.stringify(servers));
        const fixtureServer = servers.data.find((server: unknown) => isRecord(server) && server.name === 'cdp-targets');
        assert.ok(
            isRecord(fixtureServer) && isRecord(fixtureServer.tools) && fixtureServer.tools.dct_connection_status,
            JSON.stringify(servers),
        );
        for (const name of [
            'dct_connection_start',
            'dct_connection_restart',
            'dct_connection_stop',
            'dct_connection_end_task',
            'dct_operation_wait',
            'dct_operation_cancel',
        ])
            assert.ok(
                isRecord(fixtureServer.tools) && fixtureServer.tools[name],
                `Missing lifecycle declaration: ${name}`,
            );
        async function turn(prompt: string) {
            assert.ok(app);
            const before = completed.length;
            const finished = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`Isolated Codex turn timed out: ${String(failure)}`)),
                    45_000,
                );
                wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            await app.request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }] });
            if (completed.length > before) wake?.();
            await finished;
            wake = undefined;
            if (failure) throw failure;
            const result = completed.at(-1);
            assert.ok(isRecord(result?.turn));
            assert.equal(result.turn.status, 'completed', JSON.stringify(result));
        }
        await turn('Use the CDP fixture once, then finish.');
        assert.ok(state, 'The model must receive the started fixture identity from its actual status call.');
        if (mode === 'idle') {
            assert.ok(requests.every((request) => !texts(request).some((text) => text.includes(hookMarker))));
            await fetch(String(state.signalUrl), { method: 'POST' });
            assert.equal(requests.length, 4, 'Idle exit must not wake the model.');
            await turn('Continue with the fixture.');
        }
        const contexts = requests.map(texts);
        const projected = contexts.map((entries) => entries.flatMap(hookEvents));
        const notices = contexts.map((entries) =>
            entries.filter((entry) => hookEvents(entry).some((events) => events.exits.length > 0)),
        );
        if (mode === 'lifecycle') {
            const notices = projected.flatMap((events) => events.flatMap((event) => event.operations));
            assert.equal(
                notices.length,
                1,
                'One unread completion must reach actual model context before wait without a Stop duplicate.',
            );
            assert.equal(notices[0]?.operationId, operationId);
            assert.equal(notices[0]?.action, 'start');
            assert.equal(notices[0]?.state, 'succeeded');
            assert.equal(notices[0]?.phase, 'succeeded');
            assert.notEqual(notices[0]?.connectionId, state.connectionId);
            assert.notEqual(notices[0]?.sessionId, state.sessionId);
            assert.ok(
                projected.every((events) =>
                    events.every((event) => event.exits.length === 0 && event.connections.length === 0),
                ),
            );
            const output = requests.at(-1)?.input;
            assert.ok(Array.isArray(output));
            const waited = output.find(
                (item: unknown) => isRecord(item) && item.type === 'function_call_output' && item.call_id === 'call-4',
            );
            assert.ok(isRecord(waited) && typeof waited.output === 'string');
            const result: unknown = JSON.parse(waited.output.slice(waited.output.indexOf('{')));
            assert.ok(isRecord(result) && result.complete === true && isRecord(result.operation));
            assert.equal(result.operation.operationId, operationId);
            assert.equal(result.operation.state, 'succeeded');
            assertSummary(result.operation.result);
            assert.ok(!JSON.stringify(projected).includes('HOOK_PRIVATE_APP_ARGUMENTS'));
            const received = JSON.stringify(requests);
            for (const field of ['mcpArgs', 'executable', 'requestId', 'operationId', 'cursor'])
                assert.ok(received.includes(field));
            assert.ok(!received.includes('launchCommand'));
            assert.equal(requests.length, 5);
        } else if (mode === 'untrusted')
            assert.ok(
                notices.every((entries) => entries.length === 0),
                'Installing a Plugin must not trust its Hooks.',
            );
        else {
            const delivery = mode === 'pre' || mode === 'post' ? 3 : 4;
            assert.ok(
                notices.slice(0, delivery).every((entries) => entries.length === 0),
                'Live targets must stay quiet.',
            );
            assert.equal(
                notices[delivery]?.length,
                1,
                'Exit reminder must reach an actual model request: ' +
                    JSON.stringify({
                        marker: requests.map((request) => JSON.stringify(request).includes(hookMarker)),
                        hookNotifications,
                    }),
            );
            assert.ok(notices[delivery]?.[0]?.includes(String(state.connectionId)));
            assert.ok(notices[delivery]?.[0]?.includes(String(state.sessionId)));
            const exits = projected[delivery]?.flatMap((event) => event.exits);
            assert.ok(exits);
            assert.equal(exits?.length, 1);
            assert.equal(exits[0]?.connectionId, state.connectionId);
            assert.equal(exits[0]?.sessionId, state.sessionId);
            assert.equal(exits[0]?.taskActive, mode !== 'inactive');
            assert.equal(exits[0]?.expected, undefined);
            if (mode === 'post') {
                const completed = toolCompletions.find((item) => item.tool === 'list_pages');
                assert.ok(completed, JSON.stringify(toolCompletions));
                assert.equal(completed.status, 'completed');
                assert.ok(completed.error === null || completed.error === undefined);
                assert.ok(isRecord(completed.result));
                assert.notEqual(completed.result.isError, true);
                assert.deepEqual(completed.result.content, [{ type: 'text', text: '0: fixture page' }]);
                assert.ok(Array.isArray(requests[delivery]?.input));
                const returned = requests[delivery].input.find(
                    (item: unknown) =>
                        isRecord(item) && item.type === 'function_call_output' && item.call_id === 'call-3',
                );
                assert.ok(isRecord(returned));
                const output = returned.output;
                const text = typeof output === 'string' ? [output] : output;
                assert.ok(Array.isArray(text));
                assert.ok(
                    text.some((part: unknown) =>
                        typeof part === 'string'
                            ? part.trimEnd() === '0: fixture page'
                            : isRecord(part) &&
                              part.type === 'input_text' &&
                              typeof part.text === 'string' &&
                              part.text.trimEnd() === '0: fixture page',
                    ),
                    JSON.stringify(returned),
                );
            }
            if (mode === 'inactive') assert.ok(!notices[delivery]?.[0]?.includes('Ask the user whether to start'));
            assert.equal(requests.length, mode === 'pre' || mode === 'post' ? 4 : 5, 'Stop must resume at most once.');
        }
        assert.deepEqual(
            calls,
            mode === 'lifecycle'
                ? ['tool_search', 'dct_connection_status', 'dct_connection_start', 'dct_operation_wait']
                : [
                      'tool_search',
                      'dct_connection_status',
                      mode === 'inactive' ? 'dct_connection_end_task' : 'list_pages',
                  ],
        );
        assert.ok(requests.every((request) => !JSON.stringify(request.tools).includes('dct_watch_target')));
        console.log(
            JSON.stringify({
                mode,
                modelRequests: requests.length,
                modelVisibleNotice: mode !== 'untrusted',
                agentCalls: calls,
            }),
        );
    } finally {
        await app?.close();
        await new Promise<void>((resolve, reject) => model.close((error) => (error ? reject(error) : resolve())));
        await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
}

assert.ok(!process.argv[3] || scenarios.some((mode) => mode === process.argv[3]), 'Unknown Codex Hook scenario.');
for (const mode of scenarios) if (!process.argv[3] || process.argv[3] === mode) await scenario(mode);
