import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { createStdioClient } from './mcp-client.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executable = process.argv[2] ?? 'codex';
const marker = 'CDP target process exited during active work.';

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

async function scenario(mode: 'pre' | 'post' | 'stop' | 'idle' | 'untrusted') {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-codex-hooks-'));
    const home = path.join(temporary, 'home');
    const workspace = path.join(temporary, 'workspace');
    const pluginRoot = path.join(temporary, 'marketplace/plugins/debugging-cdp-targets');
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
                    arguments: { query: 'dct_connection_status list_pages', limit: 20 },
                };
            } else if (index <= 3) {
                const name = index === 2 ? 'dct_connection_status' : 'list_pages';
                if (index === 3) {
                    assert.ok(Array.isArray(value.input));
                    const output = value.input.find(
                        (entry: unknown) =>
                            isRecord(entry) && entry.type === 'function_call_output' && entry.call_id === 'call-2',
                    );
                    assert.ok(isRecord(output) && typeof output.output === 'string');
                    const status: unknown = JSON.parse(output.output.slice(output.output.indexOf('{')));
                    assert.ok(isRecord(status) && Array.isArray(status.connections) && isRecord(status.connections[0]));
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
                        index === 2 ? {} : { _dct: { connectionId: state?.connectionId, sessionId: state?.sessionId } },
                    ),
                };
            } else {
                if (mode === 'stop' && index === 4) {
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
            await readFile(path.join(root, 'plugins/debugging-cdp-targets/.codex-plugin/plugin.json')),
        );
        await writeFile(
            path.join(pluginRoot, 'hooks/hooks.json'),
            await readFile(path.join(root, 'plugins/debugging-cdp-targets/hooks/hooks.json')),
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
                        source: { source: 'local', path: './plugins/debugging-cdp-targets' },
                    },
                ],
            }),
        );
        codex(['plugin', 'marketplace', 'add', path.join(temporary, 'marketplace'), '--json']);
        codex(['plugin', 'add', 'debugging-cdp-targets@dct-hook-test', '--json']);
        const completed: Record<string, unknown>[] = [];
        const hookNotifications: unknown[] = [];
        let wake: (() => void) | undefined;
        app = createStdioClient(
            executable,
            ['app-server', '--listen', 'stdio://'],
            { cwd: workspace, env: environment },
            undefined,
            (method, params) => {
                if (/hook/i.test(method)) hookNotifications.push({ method, params });
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
            assert.ok(requests.every((request) => !texts(request).some((text) => text.includes(marker))));
            await fetch(String(state.signalUrl), { method: 'POST' });
            assert.equal(requests.length, 4, 'Idle exit must not wake the model.');
            await turn('Continue with the fixture.');
        }
        const contexts = requests.map(texts);
        const notices = contexts.map((entries) => entries.filter((entry) => entry.includes(marker)));
        if (mode === 'untrusted')
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
                        marker: requests.map((request) => JSON.stringify(request).includes(marker)),
                        hookNotifications,
                    }),
            );
            assert.ok(notices[delivery]?.[0]?.includes(String(state.connectionId)));
            assert.ok(notices[delivery]?.[0]?.includes(String(state.sessionId)));
            assert.equal(requests.length, mode === 'pre' || mode === 'post' ? 4 : 5, 'Stop must resume at most once.');
        }
        assert.deepEqual(calls, ['tool_search', 'dct_connection_status', 'list_pages']);
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

for (const mode of ['untrusted', 'pre', 'post', 'stop', 'idle'] as const) await scenario(mode);
