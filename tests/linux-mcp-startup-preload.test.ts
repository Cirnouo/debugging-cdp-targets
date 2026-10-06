import assert from 'node:assert/strict';
import { ChildProcess, type SpawnOptions, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isRecord } from '../src/shared/errors.ts';
import {
    boundedDiagnosticError,
    type ChromeCapture,
    captureChromeSpawn,
    createChromeOutputFiles,
    createDiagnosticWriter,
    injectGatewayPreload,
    observeOwnedFetch,
    preloadRole,
} from './smoke/linux-mcp-startup-support.ts';

const gateway = path.resolve('plugins/codex/debugging-cdp-targets/dist/mcp-bootstrap.mjs');
const smoke = path.resolve('tests/smoke/official-server.ts');
const entries = { gateway, smokes: [smoke, path.resolve('tests/smoke/entry-recovery.ts')] };

test('preload activates only exact original smoke and Codex gateway paths', () => {
    assert.equal(preloadRole(smoke, entries), 'parent');
    assert.equal(preloadRole(gateway, entries), 'gateway');
    for (const entry of [
        undefined,
        '/other/official-server.ts',
        `${gateway}.old`,
        path.resolve('plugins/claude-code/debugging-cdp-targets/dist/mcp-bootstrap.mjs'),
    ]) {
        assert.equal(preloadRole(entry, entries), 'inactive');
    }
});

function fakeSpawn() {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 54321 });
    const calls: unknown[][] = [];
    const original = new Proxy(spawn, {
        apply(_target, _receiver, args: unknown[]) {
            calls.push(args);
            return child;
        },
    });
    return { child, calls, original };
}

test('parent injects only exact Node gateway argv and preserves options/environment/native child', () => {
    const { child, calls, original } = fakeSpawn();
    const options: SpawnOptions = { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: { FIXTURE: 'literal' } };
    const wrapped = injectGatewayPreload(original, process.execPath, gateway, 'file:///preload.ts?directory=owned');
    assert.equal(wrapped(process.execPath, [gateway], options), child);
    assert.deepEqual(calls[0]?.[1], ['--import', 'file:///preload.ts?directory=owned', gateway]);
    assert.equal(calls[0]?.[2], options);
    for (const [command, args] of [
        [process.execPath, ['/other/mcp-bootstrap.mjs']],
        [process.execPath, [gateway, 'extra']],
        ['/other/node', [gateway]],
    ] as const) {
        assert.equal(wrapped(command, args, options), child);
        assert.equal(calls.at(-1)?.[1], args);
        assert.equal(calls.at(-1)?.[2], options);
    }
});

function captureFixture(record: ChromeCapture['record'] = () => {}) {
    const opened: number[] = [];
    const closed: number[] = [];
    const capture: ChromeCapture = {
        ownedPorts: new Set(),
        open(stream) {
            const fd = stream === 'stdout' ? 100 : 101;
            opened.push(fd);
            return { fd, path: `/owned/${stream}.log` };
        },
        close(fd) {
            closed.push(fd);
        },
        record,
    };
    return { capture, opened, closed };
}

test('Chrome wrapper changes only ignored output FDs and retains native spawn return/argv/options/env', () => {
    const { child, calls, original } = fakeSpawn();
    const { capture, closed } = captureFixture();
    const wrapped = captureChromeSpawn(original, '/opt/google/chrome/chrome', capture);
    const args = ['--remote-debugging-port=19222', '--remote-debugging-address=127.0.0.1'];
    const options = {
        cwd: '/opt/google/chrome',
        detached: true,
        shell: false,
        windowsHide: false,
        stdio: 'ignore' as const,
        env: { DISPLAY: ':99' },
    };
    assert.equal(wrapped('/opt/google/chrome/chrome', args, options), child);
    assert.equal(calls[0]?.[1], args);
    assert.deepEqual(calls[0]?.[2], { ...options, stdio: ['ignore', 100, 101] });
    const actual = calls[0]?.[2];
    assert.ok(actual && typeof actual === 'object' && 'env' in actual);
    assert.equal(actual.env, options.env);
    assert.deepEqual(closed, [100, 101]);
    assert.equal(capture.ownedPorts.has(19222), true);
    child.emit('exit', 0, null);
    assert.equal(capture.ownedPorts.has(19222), false);
    assert.equal(wrapped('/other/chrome', args, options), child);
    assert.equal(calls.at(-1)?.[2], options);
});

test('Chrome wrapper preserves synchronous native throw and closes both FDs', () => {
    const expected = new Error('native spawn rejection');
    const original = new Proxy(spawn, {
        apply() {
            throw expected;
        },
    });
    const { capture, closed } = captureFixture(() => {
        throw new Error('diagnostic sink failure');
    });
    const wrapped = captureChromeSpawn(original, '/chrome', capture);
    assert.throws(
        () => wrapped('/chrome', ['--remote-debugging-port=19222'], { detached: true, shell: false, stdio: 'ignore' }),
        (error) => error === expected,
    );
    assert.deepEqual(closed, [100, 101]);
});

test('nonmatching Chrome options and ambiguous ports retain original invocation without diagnostic IO', () => {
    const { calls, original } = fakeSpawn();
    const { capture, opened } = captureFixture();
    const wrapped = captureChromeSpawn(original, '/chrome', capture);
    const normal = { detached: true, shell: false, stdio: 'ignore' as const };
    const argv = ['--remote-debugging-port=19222'];
    for (const options of [
        { ...normal, shell: true },
        { ...normal, detached: false },
        { ...normal, stdio: 'pipe' as const },
    ]) {
        wrapped('/chrome', argv, options);
        assert.equal(calls.at(-1)?.[1], argv);
        assert.equal(calls.at(-1)?.[2], options);
    }
    for (const args of [
        ['--remote-debugging-port=19222', '--remote-debugging-port=19422'],
        ['--remote-debugging-port=1'],
        [],
    ]) {
        wrapped('/chrome', args, normal);
        assert.equal(calls.at(-1)?.[1], args);
        assert.equal(calls.at(-1)?.[2], normal);
    }
    assert.deepEqual(opened, []);
});

test('failed diagnostic FD allocation falls back once to unchanged native spawn', () => {
    const { child, calls, original } = fakeSpawn();
    const { capture, closed } = captureFixture();
    capture.open = (stream) => {
        if (stream === 'stderr') throw new Error('disk unavailable');
        return { fd: 100, path: '/owned/stdout' };
    };
    const args = ['--remote-debugging-port=19222'];
    const options = { detached: true, shell: false, stdio: 'ignore' as const };
    assert.equal(captureChromeSpawn(original, '/chrome', capture)('/chrome', args, options), child);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[1], args);
    assert.equal(calls[0]?.[2], options);
    assert.deepEqual(closed, [100]);
});

test('real private Node stdout/stderr use inherited files with actual native PID and normal exit', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'dct-preload-regression-'));
    const outputs: { stdout: string; stderr: string }[] = [];
    const capture: ChromeCapture = {
        ...createChromeOutputFiles(folder),
        ownedPorts: new Set(),
        record(event) {
            if (
                event.event === 'chrome-created' &&
                typeof event.stdout === 'string' &&
                typeof event.stderr === 'string'
            )
                outputs.push({ stdout: event.stdout, stderr: event.stderr });
        },
    };
    try {
        for (let index = 0; index < 2; index += 1) {
            const child = captureChromeSpawn(spawn, process.execPath, capture)(
                process.execPath,
                [
                    '-e',
                    'process.stdout.write("fixture output"); process.stderr.write("fixture error");',
                    '--',
                    '--remote-debugging-port=19222',
                ],
                { detached: true, shell: false, stdio: 'ignore', windowsHide: true },
            );
            assert.ok(child instanceof ChildProcess && Number.isInteger(child.pid));
            await new Promise<void>((resolve, reject) => {
                child.once('error', reject);
                child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
            });
            const output = outputs[index];
            assert.ok(output);
            assert.equal(readFileSync(output.stdout, 'utf8'), 'fixture output');
            assert.equal(readFileSync(output.stderr, 'utf8'), 'fixture error');
            assert.equal(capture.ownedPorts.size, 0);
        }
        assert.equal(new Set(outputs.flatMap(({ stdout, stderr }) => [stdout, stderr])).size, 4);
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

test('fetch observer returns original Promise/Response and forwards arguments/signal without reading body', async () => {
    const response = new Response('private fixture body');
    let bodyReads = 0;
    Object.defineProperty(response, 'body', {
        get() {
            bodyReads += 1;
            throw new Error('Body must stay unread');
        },
    });
    const pending = Promise.resolve(response);
    const calls: unknown[][] = [];
    const events: Record<string, unknown>[] = [];
    const original = new Proxy(fetch, {
        apply(_target, _receiver, args: unknown[]) {
            calls.push(args);
            return pending;
        },
    });
    const wrapped = observeOwnedFetch(original, new Set([19222]), (event) => events.push(event));
    const options = { signal: AbortSignal.timeout(1_000), redirect: 'error' as const };
    assert.equal(wrapped('http://127.0.0.1:19222/json/version', options), pending);
    assert.equal(await pending, response);
    assert.equal(calls[0]?.[1], options);
    await Promise.resolve();
    assert.equal(bodyReads, 0);
    assert.equal(events[0]?.event, 'fetch-success');
    const before = events.length;
    assert.equal(wrapped('http://127.0.0.1:19223/json/version', options), pending);
    assert.equal(wrapped('http://localhost:19222/json/version', options), pending);
    await Promise.resolve();
    assert.equal(events.length, before);
});

test('fetch rejection/error identity remains exact and throwing side observers create no unhandled rejection', async () => {
    const expected = Object.assign(new Error('fetch failed'), {
        cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    });
    const pending = Promise.reject(expected);
    const original = new Proxy(fetch, {
        apply() {
            return pending;
        },
    });
    let sideCalls = 0;
    const wrapped = observeOwnedFetch(original, new Set([19222]), () => {
        sideCalls += 1;
        throw new Error('sink failed');
    });
    assert.equal(wrapped('http://127.0.0.1:19222/json/version'), pending);
    await assert.rejects(pending, (error) => error === expected);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(sideCalls, 1);
});

test('synchronous fetch throw and abort rejection preserve original Error, Promise and signal identities', async () => {
    const expected = new Error('original synchronous fetch error');
    const events: Record<string, unknown>[] = [];
    const throwing = new Proxy(fetch, {
        apply() {
            throw expected;
        },
    });
    assert.throws(
        () =>
            observeOwnedFetch(throwing, new Set([19222]), (event) => events.push(event))(
                'http://127.0.0.1:19222/json/version',
            ),
        (error) => error === expected,
    );
    assert.equal(events[0]?.event, 'fetch-throw');
    const controller = new AbortController();
    const abort = new Error('original cancellation reason');
    const promise = new Promise<Response>((_resolve, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }),
    );
    const original = new Proxy(fetch, {
        apply(_target, _receiver, args: unknown[]) {
            assert.ok(isRecord(args[1]));
            assert.equal(args[1].signal, controller.signal);
            return promise;
        },
    });
    assert.equal(
        observeOwnedFetch(original, new Set([19222]), (event) => events.push(event))(
            'http://127.0.0.1:19222/json/version',
            { signal: controller.signal },
        ),
        promise,
    );
    controller.abort(abort);
    await assert.rejects(promise, (error) => error === abort);
    assert.equal(events.at(-1)?.event, 'fetch-error');
});

test('bounded diagnostic errors reject unknown fields and cyclic aggregate explosion', () => {
    const error = Object.assign(new Error('x'.repeat(1_000)), { code: 'ECONNREFUSED', secret: 'private-secret' });
    error.cause = error;
    const output = JSON.stringify(
        boundedDiagnosticError(new AggregateError(Array(100).fill(error), 'fetch failed', { cause: error })),
    );
    assert.match(output, /ECONNREFUSED/);
    assert.doesNotMatch(output, /private-secret/);
    assert.ok(output.length < 5_000);
    assert.match(output, /truncated/);
});

test('diagnostic event file caps output and contains only complete bounded JSON records', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'dct-diagnostic-records-'));
    try {
        const file = path.join(folder, 'events.jsonl');
        const record = createDiagnosticWriter(file);
        record({ event: 'oversized', message: 'x'.repeat(100_000) });
        for (let index = 0; index < 2_000; index += 1) record({ event: 'fixture', index, message: 'y'.repeat(1_000) });
        const bytes = readFileSync(file);
        assert.ok(bytes.length <= 262_144);
        const lines = bytes.toString('utf8').trim().split('\n');
        assert.ok(lines.length < 1_024);
        for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
        assert.match(lines[0] ?? '', /truncated/);
        assert.match(lines.at(-1) ?? '', /output-bounded/);
        assert.throws(() => createDiagnosticWriter(file), /EEXIST/);
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

test('inactive actual preload changes no hooks, creates no files and leaves stdout as original JSON', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'dct-inactive-preload-'));
    try {
        const unused = path.join(folder, 'unused');
        const preload = new URL('./smoke/linux-mcp-startup-preload.ts', import.meta.url);
        preload.searchParams.set('directory', unused);
        const baseline =
            'data:text/javascript,' +
            encodeURIComponent(
                'import cp from "node:child_process"; globalThis.fixtureSpawn = cp.spawn; globalThis.fixtureFetch = fetch;',
            );
        const result = spawnSync(
            process.execPath,
            [
                '--import',
                baseline,
                '--import',
                preload.href,
                '--input-type=module',
                '-e',
                'import cp from "node:child_process"; process.stdout.write(JSON.stringify({ spawnUnchanged: cp.spawn === globalThis.fixtureSpawn, fetchUnchanged: fetch === globalThis.fixtureFetch }));',
            ],
            { encoding: 'utf8', shell: false, timeout: 10_000, windowsHide: true },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { spawnUnchanged: true, fetchUnchanged: true });
        assert.equal(existsSync(unused), false);
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

test('parent preload flags propagate to a private gateway before named builtin bindings and preserve JSON stdout', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'dct-preload-propagation-'));
    try {
        const fixtureGateway = path.join(folder, 'gateway.ts');
        writeFileSync(
            fixtureGateway,
            'import { spawn } from "node:child_process"; process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{bindingSynced:spawn === globalThis.fixtureSpawn,entry:process.argv[1]}}));\n',
        );
        const preload =
            'data:text/javascript,' +
            encodeURIComponent(
                'import cp from "node:child_process"; import {syncBuiltinESMExports} from "node:module"; cp.spawn = new Proxy(cp.spawn, {apply(target,receiver,args){return Reflect.apply(target,receiver,args);}}); globalThis.fixtureSpawn=cp.spawn; syncBuiltinESMExports();',
            );
        const child = injectGatewayPreload(
            spawn,
            process.execPath,
            fixtureGateway,
            preload,
        )(process.execPath, [fixtureGateway], { stdio: 'pipe', shell: false, windowsHide: true });
        assert.ok(child instanceof ChildProcess && Number.isInteger(child.pid));
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (bytes) => {
            stdout += bytes;
        });
        child.stderr.on('data', (bytes) => {
            stderr += bytes;
        });
        await new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
        });
        const message: unknown = JSON.parse(stdout);
        assert.ok(isRecord(message) && isRecord(message.result));
        assert.equal(message.jsonrpc, '2.0');
        assert.equal(message.result.bindingSynced, true);
        assert.equal(message.result.entry, fixtureGateway);
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});
