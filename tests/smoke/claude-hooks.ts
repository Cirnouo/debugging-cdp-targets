import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSummary, hookEvents, hookMarker } from '../fixtures/hook-gateway-events.ts';
import type { ClaudeBlock, ClaudeRequest } from './claude-host.ts';
import { claudeContext, claudeRequest, claudeSse, claudeToolResult, record } from './claude-host.ts';
import { claudeCli, claudeHost, sandbox } from './claude-process.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executable =
    process.argv[2] ?? (process.platform === 'win32' ? path.join(os.homedir(), '.local/bin/claude.exe') : 'claude');
const modes = ['pre', 'post', 'stop', 'idle', 'inactive', 'lifecycle', 'skill', 'disabled'] as const;
type Mode = (typeof modes)[number];

async function scenario(mode: Mode) {
    const { temporary, workspace } = await sandbox(root, `hooks-${mode}`);
    const marketplace = path.join(temporary, 'marketplace');
    const pluginRoot = path.join(marketplace, 'plugins/claude-code/debugging-cdp-targets');
    await mkdir(path.join(marketplace, '.claude-plugin'), { recursive: true });
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await cp(
        path.join(root, '.claude-plugin/marketplace.json'),
        path.join(marketplace, '.claude-plugin/marketplace.json'),
    );
    for (const name of ['.claude-plugin/plugin.json', 'hooks', 'skills'])
        await cp(path.join(root, 'plugins/claude-code/debugging-cdp-targets', name), path.join(pluginRoot, name), {
            recursive: true,
        });
    const statePath = path.join(temporary, 'target.json');
    await writeFile(
        path.join(pluginRoot, '.mcp.json'),
        JSON.stringify(
            {
                mcpServers: {
                    'cdp-targets': {
                        command: process.execPath,
                        args: [path.join(root, 'tests/fixtures/hook-gateway.ts')],
                        env: {
                            DCT_HOOK_FIXTURE_STATE: statePath,
                            DCT_HOOK_FIXTURE_EXIT: mode === 'disabled' ? 'post' : mode,
                        },
                    },
                },
            },
            null,
            4,
        ),
    );
    const requests: ClaudeRequest[] = [];
    const calls: string[] = [];
    let state: Record<string, unknown> | undefined;
    let failure: unknown;
    let operationId: string | undefined;
    function tool(value: ClaudeRequest, name: string, input: Record<string, unknown>, index: number): ClaudeBlock {
        const declaration = value.tools.find(
            (candidate) => typeof candidate.name === 'string' && candidate.name.endsWith(`__${name}`),
        );
        assert.ok(declaration && typeof declaration.name === 'string', `Actual Claude catalog omitted ${name}.`);
        calls.push(name);
        return { type: 'tool_use', id: `toolu_${index}`, name: declaration.name, input };
    }
    async function signalExit() {
        assert.ok(state && typeof state.signalUrl === 'string');
        const url = new URL(state.signalUrl);
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(url.protocol, 'http:');
        assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    }
    const model = createServer(async (request, response) => {
        try {
            if (request.method === 'HEAD' && request.url === '/api/hello') {
                response.end();
                return;
            }
            if (request.method === 'POST' && request.url?.startsWith('/v1/messages/count_tokens')) {
                response.end('{"input_tokens":10}');
                return;
            }
            assert.equal(request.method, 'POST');
            assert.ok(
                request.url === '/v1/messages' || request.url === '/v1/messages?beta=true',
                'Unexpected synthetic provider endpoint.',
            );
            assert.equal(request.headers['x-api-key'], 'sk-ant-synthetic-dct-smoke');
            let raw = '';
            for await (const chunk of request) raw += chunk;
            const value = claudeRequest(raw);
            requests.push(value);
            await writeFile(path.join(temporary, 'requests.json'), JSON.stringify(requests, null, 4));
            assert.ok(requests.length <= 5, 'Hooks must not create infinite model continuations.');
            const index = requests.length;
            let block: ClaudeBlock = { type: 'text', text: 'Fixture completed.' };
            if (index === 1) block = tool(value, 'dct_connection_status', {}, index);
            else if (index === 2) {
                const status = claudeToolResult(value.messages, 'toolu_1');
                assertSummary(status);
                assert.ok(
                    Array.isArray(status.connections) &&
                        record(status.connections[0]) &&
                        typeof status.connections[0].connectionId === 'string',
                );
                const actual: unknown = JSON.parse(
                    await readFile(`${statePath}.${status.connections[0].connectionId}`, 'utf8'),
                );
                assert.ok(record(actual));
                state = actual;
                if (mode === 'pre') await signalExit();
                block =
                    mode === 'lifecycle'
                        ? tool(
                              value,
                              'dct_connection_start',
                              {
                                  entryId: state.entryId,
                                  requestId: 'claude-start',
                                  isolation: { mode: 'none' },
                                  launch: {
                                      executable: 'fake target',
                                      args: [],
                                      env: { DCT_FIXTURE: 'HOOK_PRIVATE_APP_ARGUMENTS' },
                                  },
                                  mcpArgs: ['--workspace', workspace],
                              },
                              index,
                          )
                        : mode === 'inactive'
                          ? tool(
                                value,
                                'dct_connection_end_task',
                                {
                                    entryId: state.entryId,
                                    connectionId: state.connectionId,
                                    sessionId: state.sessionId,
                                    requestId: 'claude-end-task',
                                },
                                index,
                            )
                          : tool(
                                value,
                                'list_pages',
                                { _dct: { connectionId: state.connectionId, sessionId: state.sessionId } },
                                index,
                            );
            } else if (mode === 'lifecycle' && index === 3) {
                const accepted = claudeToolResult(value.messages, 'toolu_2');
                assert.equal(typeof accepted.operationId, 'string');
                assert.ok(typeof accepted.operationId === 'string');
                operationId = accepted.operationId;
                assert.ok(typeof state?.releaseUrl === 'string');
                assert.equal((await fetch(state.releaseUrl, { method: 'POST' })).status, 200);
                block = tool(
                    value,
                    'dct_operation_wait',
                    { entryId: state?.entryId, operationId: accepted.operationId, cursor: 0 },
                    index,
                );
            } else if ((mode === 'stop' || mode === 'inactive') && index === 3) await signalExit();
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.end(claudeSse(value.model, index, block));
        } catch (error) {
            failure = error;
            response.writeHead(500);
            response.end(String(error));
        }
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    const address = model.address();
    assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}`;
    try {
        await claudeCli(executable, ['plugin', 'marketplace', 'add', marketplace], temporary, endpoint);
        await claudeCli(
            executable,
            ['plugin', 'install', 'debugging-cdp-targets@debugging-cdp-targets', '--json'],
            temporary,
            endpoint,
        );
        const extra = ['--allowedTools', 'mcp__plugin_debugging-cdp-targets_cdp-targets__*'];
        if (mode === 'disabled') extra.push('--settings', '{"disableAllHooks":true}');
        const host = await claudeHost(
            executable,
            temporary,
            endpoint,
            extra,
            mode === 'skill'
                ? '/debugging-cdp-targets:debugging-cdp-targets'
                : 'Use the isolated CDP fixture once, then finish.',
            async (turn) => {
                if (mode === 'idle' && turn === 1) {
                    assert.equal(requests.length, 3);
                    assert.ok(
                        requests.every((value) => !claudeContext(value).some((text) => text.includes(hookMarker))),
                    );
                    await signalExit();
                    // Hold the idle host across the observed exit before sending a new prompt.
                    await new Promise<void>((resolve) => setTimeout(resolve, 200));
                    assert.equal(requests.length, 3, 'Idle exit must not wake the model.');
                    return 'Continue the isolated fixture.';
                }
                return undefined;
            },
        );
        if (failure) throw failure;
        assert.ok(state, 'Actual model must receive production status identity.');
        assert.ok(
            Array.isArray(host.init.tools) && host.init.tools.length === 8,
            'Fixture has seven real lifecycle tools and one fake official I/O tool.',
        );
        const hooks = host.events.filter((event) => event.subtype === 'hook_response');
        assert.ok(
            hooks.every((event) => event.outcome === 'success' && event.exit_code === 0),
            JSON.stringify(hooks),
        );
        const contexts = requests.map(claudeContext);
        const projected = contexts.map((entries) => entries.flatMap(hookEvents));
        const notices = contexts.map((entries) =>
            entries.filter((text) => hookEvents(text).some((events) => events.exits.length > 0)),
        );
        if (mode === 'disabled') {
            assert.equal(hooks.length, 0);
            assert.ok(notices.every((entries) => entries.length === 0));
            assert.equal(requests.length, 3);
        } else {
            for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'])
                assert.ok(
                    hooks.some((hook) => hook.hook_event === event),
                    `Actual Claude did not execute ${event}.`,
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
                const result = claudeToolResult(requests.at(-1)?.messages ?? [], 'toolu_3');
                assert.ok(result.complete === true && record(result.operation));
                assert.equal(result.operation.operationId, operationId);
                assert.equal(result.operation.state, 'succeeded');
                assertSummary(result.operation.result);
                assert.ok(!JSON.stringify(projected).includes('HOOK_PRIVATE_APP_ARGUMENTS'));
                assert.ok(
                    projected.every((events) =>
                        events.every((event) => event.exits.length === 0 && event.connections.length === 0),
                    ),
                );
                for (const field of ['mcpArgs', 'executable', 'requestId', 'operationId', 'cursor'])
                    assert.ok(JSON.stringify(requests).includes(field));
                assert.ok(!JSON.stringify(requests).includes('launchCommand'));
                assert.equal(requests.length, 4);
            } else if (mode === 'skill') {
                const skill = await readFile(path.join(pluginRoot, 'skills/debugging-cdp-targets/SKILL.md'), 'utf8');
                const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
                assert.ok(
                    contexts[0]?.some((text) => text.includes(body)),
                    'Namespaced Skill invocation must put complete installed instructions in actual outbound model context.',
                );
                assert.equal(requests.length, 3);
            } else {
                const delivery = mode === 'pre' || mode === 'post' ? 2 : 3;
                assert.ok(notices.slice(0, delivery).every((entries) => entries.length === 0));
                // Claude renders one blocking Stop reason in both a system reminder
                // and Stop feedback. Hook execution and continuation count establish
                // single delivery independently of those host context wrappers.
                if (mode === 'stop' || mode === 'inactive') assert.ok((notices[delivery]?.length ?? 0) >= 1);
                else assert.equal(notices[delivery]?.length, 1, JSON.stringify({ contexts, hooks }));
                assert.ok(notices[delivery]?.[0]?.includes(String(state.connectionId)));
                assert.ok(notices[delivery]?.[0]?.includes(String(state.sessionId)));
                const exits = projected[delivery]?.flatMap((event) => event.exits);
                assert.ok(exits && exits.length >= 1);
                for (const event of exits) {
                    assert.equal(event.connectionId, state.connectionId);
                    assert.equal(event.sessionId, state.sessionId);
                    assert.equal(event.taskActive, mode !== 'inactive');
                    assert.equal(event.expected, undefined);
                }
                if (mode === 'inactive') assert.ok(!notices[delivery]?.[0]?.includes('Ask the user whether to start'));
                const event =
                    mode === 'pre'
                        ? 'PreToolUse'
                        : mode === 'post'
                          ? 'PostToolUse'
                          : mode === 'idle'
                            ? 'UserPromptSubmit'
                            : 'Stop';
                const delivered = hooks.filter(
                    (hook) =>
                        typeof hook.output === 'string' &&
                        hookEvents(hook.output).some((events) => events.exits.length > 0),
                );
                assert.equal(delivered.length, 1, 'Exit reminder is delivered once across all Hook boundaries.');
                assert.equal(delivered[0]?.hook_event, event);
                if (mode === 'post') {
                    const returned = requests[delivery]?.messages
                        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                        .find(
                            (item: unknown) =>
                                record(item) && item.type === 'tool_result' && item.tool_use_id === 'toolu_2',
                        );
                    assert.ok(record(returned));
                    assert.notEqual(
                        returned.is_error,
                        true,
                        'PostToolUse requires a successful original official result.',
                    );
                    const content = returned.content;
                    const text = typeof content === 'string' ? [content] : content;
                    assert.ok(Array.isArray(text));
                    assert.ok(
                        text.some((part: unknown) =>
                            typeof part === 'string'
                                ? part.split('\n\n<system-reminder>')[0] === '0: fixture page'
                                : record(part) &&
                                  part.type === 'text' &&
                                  typeof part.text === 'string' &&
                                  part.text.trimEnd() === '0: fixture page',
                        ),
                        JSON.stringify(returned),
                    );
                }
                assert.equal(
                    requests.length,
                    delivery + 1,
                    'Stop continues exactly once and other modes do not continue.',
                );
                assert.equal(
                    hooks.filter((hook) => hook.hook_event === 'Stop').length,
                    mode === 'stop' || mode === 'idle' || mode === 'inactive' ? 2 : 1,
                );
            }
        }
        assert.deepEqual(
            calls,
            mode === 'lifecycle'
                ? ['dct_connection_status', 'dct_connection_start', 'dct_operation_wait']
                : ['dct_connection_status', mode === 'inactive' ? 'dct_connection_end_task' : 'list_pages'],
        );
        await writeFile(path.join(temporary, 'requests.json'), JSON.stringify(requests, null, 4));
        console.log(
            JSON.stringify({
                mode,
                host: 'Claude Code',
                version: host.version,
                temporary,
                modelRequests: requests.length,
                hookEvents: hooks.map((hook) => hook.hook_event),
                modelCalls: calls,
            }),
        );
    } finally {
        model.closeAllConnections();
        await new Promise<void>((resolve, reject) => model.close((error) => (error ? reject(error) : resolve())));
    }
}

assert.ok(!process.argv[3] || modes.some((mode) => mode === process.argv[3]), 'Unknown Claude Hook scenario.');
for (const mode of modes) if (!process.argv[3] || process.argv[3] === mode) await scenario(mode);
