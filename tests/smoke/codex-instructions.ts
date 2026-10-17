import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { captureAppInitialization } from './app-http.ts';
import { assertSuppressedSkillContext, isolateCodexSkills, isolatedCodexEnvironment } from './codex-host.ts';
import { descriptionLocations, initializationEvidence, testedSource } from './instructions-evidence.ts';
import { createStdioClient } from './mcp-client.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executable = process.argv[2] ?? 'codex';
const exercise = process.argv.includes('--exercise-lifecycle');
const lifecycleNames = ['dct_registration_register', 'dct_connection_status'];
let bearer: string | undefined;
let registrationId: string | undefined;
const lifecycleCalls: string[] = [];
const routes = new Map<string, { name: string; namespace?: string }>();
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
        for (const child of Object.values(value))
            if (child && typeof child === 'object') {
                const found = toolRoute(child, name, namespace);
                if (found) return found;
            }
    }
    return undefined;
}
function toolOutput(value: Record<string, unknown>, callId: string) {
    assert.ok(Array.isArray(value.input));
    const output = value.input.find(
        (entry: unknown) => isRecord(entry) && entry.type === 'function_call_output' && entry.call_id === callId,
    );
    assert.ok(isRecord(output) && typeof output.output === 'string');
    const parsed: unknown = JSON.parse(output.output.slice(output.output.indexOf('{')));
    assert.ok(isRecord(parsed));
    return parsed;
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-codex-instructions-'));
console.log(`Retained evidence: ${temporary}`);
const home = path.join(temporary, 'home');
const workspace = path.join(temporary, 'workspace');
await Promise.all([mkdir(home), mkdir(workspace)]);
const environment = await isolatedCodexEnvironment(home);
const fixtureEvidence = path.join(temporary, 'app-http-initialize.json');
await captureAppInitialization(fixtureEvidence);
const requests: Record<string, unknown>[] = [];
let failure: unknown;
let locations: string[] = [];
const model = createServer(async (request, response) => {
    try {
        assert.equal(request.url, '/v1/responses');
        let raw = '';
        for await (const chunk of request) raw += chunk;
        // The first two requests precede registration. Later model context contains
        // its private bearer and is deliberately retained only in process memory.
        if (requests.length < 2) await writeFile(path.join(temporary, `request-${requests.length + 1}.json`), raw);
        const value: unknown = JSON.parse(raw);
        assert.ok(isRecord(value));
        requests.push(value);
        assert.ok(requests.length <= (exercise ? 5 : 2));
        let item: Record<string, unknown>;
        if (requests.length === 1) {
            assert.ok(
                Array.isArray(value.tools) &&
                    value.tools.some((tool: unknown) => isRecord(tool) && tool.type === 'tool_search'),
            );
            item = {
                type: 'tool_search_call',
                call_id: exercise ? 'discover-registration' : 'discover-instructions',
                execution: 'client',
                arguments: {
                    query: exercise ? 'dct_registration_register' : 'dct_registration_register dct_connection_status',
                    limit: 20,
                },
            };
        } else {
            const production = await initializationEvidence(fixtureEvidence);
            if (requests.length === 2)
                locations = descriptionLocations(value.tools, production.instructions, '$.tools');
            if (requests.length === 2 && Array.isArray(value.input))
                value.input.forEach((entry: unknown, index: number) => {
                    if (isRecord(entry) && entry.type === 'tool_search_output')
                        locations.push(
                            ...descriptionLocations(entry.tools, production.instructions, `$.input[${index}].tools`),
                        );
                });
            assert.ok(locations.length > 0, 'Complete instructions must appear in actual namespace/search metadata.');
            if (exercise && requests.length <= 3) {
                const name = requests.length === 2 ? 'dct_registration_register' : 'dct_connection_status';
                const route = toolRoute(value.tools, name) ?? toolRoute(value.input, name);
                assert.ok(route, 'The exact requested tool must appear in actual discovery metadata.');
                routes.set(name, route);
            }
            if (exercise && requests.length === 4) {
                const registered = toolOutput(value, 'register-once');
                assert.ok(
                    typeof registered.registrationBearer === 'string' && typeof registered.registrationId === 'string',
                );
                bearer = registered.registrationBearer;
                registrationId = registered.registrationId;
            }
            if (exercise && requests.length === 5) {
                const status = toolOutput(value, 'owned-status');
                assert.deepEqual(status.connections, []);
                assert.equal(JSON.stringify(status).includes(bearer ?? 'missing-bearer'), false);
            }
            if (exercise && requests.length === 2) {
                item = {
                    type: 'tool_search_call',
                    call_id: 'discover-status',
                    execution: 'client',
                    arguments: { query: 'dct_connection_status', limit: 20 },
                };
            } else if (exercise && requests.length < 5) {
                const name = requests.length === 3 ? 'dct_registration_register' : 'dct_connection_status';
                const route = routes.get(name);
                assert.ok(route);
                lifecycleCalls.push(name);
                item = {
                    type: 'function_call',
                    call_id: requests.length === 3 ? 'register-once' : 'owned-status',
                    ...route,
                    arguments: JSON.stringify(requests.length === 3 ? {} : { registrationBearer: bearer }),
                };
            } else {
                item = {
                    type: 'message',
                    role: 'assistant',
                    id: 'instructions-final',
                    content: [{ type: 'output_text', text: 'Instruction consumption fixture completed.' }],
                };
            }
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
            [
                { type: 'response.created', response: { id: `response-${requests.length}` } },
                { type: 'response.output_item.done', item },
                {
                    type: 'response.completed',
                    response: {
                        id: `response-${requests.length}`,
                        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
                    },
                },
            ]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
        );
    } catch (error) {
        const first = failure === undefined;
        failure ??= error;
        if (first) await writeFile(path.join(temporary, 'provider-failure.txt'), String(error));
        response.writeHead(500);
        response.end(String(error));
    }
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
const address = model.address();
assert.ok(address && typeof address !== 'string');
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
    return result.stdout;
}
let app: ReturnType<typeof createStdioClient> | undefined;
let turnTimer: NodeJS.Timeout | undefined;
try {
    const version = codex(['--version']).trim();
    const marketplace = path.join(temporary, 'marketplace');
    const plugin = path.join(marketplace, 'plugins/codex/debugging-cdp-targets');
    await mkdir(path.join(marketplace, '.agents/plugins'), { recursive: true });
    await mkdir(plugin, { recursive: true });
    for (const name of ['.codex-plugin', 'skills', 'assets', 'mcp.json', 'LICENSE', 'README.md'])
        await cp(path.join(root, 'plugins/codex/debugging-cdp-targets', name), path.join(plugin, name), {
            recursive: true,
        });

    await writeFile(
        path.join(marketplace, '.agents/plugins/marketplace.json'),
        JSON.stringify({
            name: 'dct-instructions-test',
            plugins: [
                {
                    name: 'debugging-cdp-targets',
                    source: { source: 'local', path: './plugins/codex/debugging-cdp-targets' },
                },
            ],
        }),
    );
    await writeFile(
        path.join(home, 'config.toml'),
        `model = "gpt-5.5"\nmodel_provider = "dct-local"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[features]\nplugins = true\nhooks = false\n[model_providers.dct-local]\nname = "Local instructions test"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n` +
            (exercise
                ? '\n[plugins."debugging-cdp-targets@dct-instructions-test".mcp_servers."cdp-targets"]\nenabled_tools = ["dct_registration_register", "dct_connection_status"]\n[plugins."debugging-cdp-targets@dct-instructions-test".mcp_servers."cdp-targets".tools."dct_registration_register"]\napproval_mode = "approve"\n[plugins."debugging-cdp-targets@dct-instructions-test".mcp_servers."cdp-targets".tools."dct_connection_status"]\napproval_mode = "approve"\n'
                : ''),
    );
    codex(['plugin', 'marketplace', 'add', marketplace, '--json']);
    const installation: unknown = JSON.parse(
        codex(['plugin', 'add', 'debugging-cdp-targets@dct-instructions-test', '--json']),
    );
    assert.ok(isRecord(installation) && typeof installation.installedPath === 'string');
    await writeFile(path.join(temporary, 'installation.json'), JSON.stringify(installation, null, 4));
    let complete: Record<string, unknown> | undefined;
    let wake: (() => void) | undefined;
    const notifications: unknown[] = [];
    app = createStdioClient(
        executable,
        ['app-server', '--listen', 'stdio://'],
        { cwd: workspace, env: environment },
        undefined,
        (method, params) => {
            notifications.push({ method, params });
            if (method === 'turn/completed') {
                complete = params;
                wake?.();
            }
        },
    );
    await app.request('initialize', {
        clientInfo: { name: 'isolated-cdp-instructions', version: '0.1.0' },
        capabilities: { experimentalApi: true },
    });
    app.notify('initialized');
    const isolated = await isolateCodexSkills(
        app,
        workspace,
        'debugging-cdp-targets@dct-instructions-test',
        path.join(installation.installedPath, 'skills/debugging-cdp-targets/SKILL.md'),
    );
    const started = await app.request('thread/start', {
        cwd: workspace,
        model: 'gpt-5.5',
        modelProvider: 'dct-local',
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
    });
    assert.ok(isRecord(started) && isRecord(started.thread) && typeof started.thread.id === 'string');
    const servers = await app.request('mcpServerStatus/list');
    await writeFile(path.join(temporary, 'servers.json'), JSON.stringify(servers, null, 4));
    assert.ok(isRecord(servers) && Array.isArray(servers.data));
    const server = servers.data.find((entry: unknown) => isRecord(entry) && entry.name === 'cdp-targets');
    assert.ok(isRecord(server) && isRecord(server.tools) && server.tools.dct_connection_status);
    assert.equal(server.pluginId, 'debugging-cdp-targets@dct-instructions-test');
    assert.deepEqual(
        Object.keys(server.tools).sort(),
        exercise ? [...lifecycleNames].sort() : (await initializationEvidence(fixtureEvidence)).toolNames,
    );
    const finished = new Promise<void>((resolve, reject) => {
        turnTimer = setTimeout(
            () => reject(new Error(`Codex instructions turn timed out: ${String(failure)}`)),
            45_000,
        );
        wake = () => {
            clearTimeout(turnTimer);
            resolve();
        };
    });
    await Promise.all([
        app.request('turn/start', {
            threadId: started.thread.id,
            input: [
                {
                    type: 'text',
                    text: exercise
                        ? 'Register once with the local inspection gateway and read only that registration status; start no target.'
                        : 'Discover the available inspection gateway, then finish without calling any tools.',
                    text_elements: [],
                },
            ],
        }),
        finished,
    ]);
    await writeFile(
        path.join(temporary, 'notifications.json'),
        JSON.stringify(
            exercise ? notifications.filter(isRecord).map((entry) => ({ method: entry.method })) : notifications,
            null,
            4,
        ),
    );
    if (failure) throw failure;
    assert.ok(isRecord(complete?.turn) && complete.turn.status === 'completed');
    assert.equal(requests.length, exercise ? 5 : 2);
    const context = requests.flatMap((request) =>
        Array.isArray(request.input)
            ? request.input
                  .filter(isRecord)
                  .flatMap((entry) =>
                      Array.isArray(entry.content)
                          ? entry.content
                                .filter(isRecord)
                                .flatMap((part) => (typeof part.text === 'string' ? [part.text] : []))
                          : [],
                  )
            : [],
    );
    assertSuppressedSkillContext(context, isolated.suppressed, isolated.approved);
    const production = await initializationEvidence(fixtureEvidence);
    await writeFile(
        path.join(temporary, 'acceptance.json'),
        JSON.stringify(
            {
                host: 'Codex',
                version,
                source: await testedSource(root),
                locations,
                lifecycleCalls,
                ...(exercise ? { registrationId, ownedEmptyStatus: true } : {}),
                ...production,
            },
            null,
            4,
        ),
    );
    console.log(
        `${version}: complete instructions consumed at ${locations.join(', ')}; host lifecycle calls ${lifecycleCalls.length}.`,
    );
} catch (error) {
    failure ??= error;
    throw error;
} finally {
    clearTimeout(turnTimer);
    if (failure) await writeFile(path.join(temporary, 'failure.txt'), String(failure));
    await app?.close();
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
}
