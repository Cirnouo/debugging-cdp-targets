import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const collectorUrl = new URL('./smoke/fixture-artifacts.ts', import.meta.url);

test('controlled fixture collector exists before smoke execution is changed', async () => {
    const implementation = await import(collectorUrl.href).catch(() => undefined);
    assert.ok(implementation?.createFixtureArtifacts, 'Missing bounded streaming fixture collector.');
});

test('streamed BEGIN survives unfinished work and closed validation prevents private data', async () => {
    const { createFixtureArtifacts } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const collector = createFixtureArtifacts(directory, 'official-server');
        collector.begin('acceptance');
        collector.gateway({ stage: 'spawn', event: 'begin', outcome: 'started', timestampMs: 1, durationMs: 0 });
        collector.gateway({
            stage: 'spawn',
            event: 'begin',
            outcome: 'started',
            timestampMs: 1,
            durationMs: 0,
            message: 'PRIVATE_TOKEN /Users/private',
        });
        const stream = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.match(stream, /"event":"begin"/);
        assert.match(stream, /"stage":"spawn"/);
        assert.doesNotMatch(stream, /PRIVATE_TOKEN|Users/);
        const summary = JSON.parse(await readFile(path.join(directory, 'official-server.summary.json'), 'utf8'));
        assert.equal(summary.state, 'running');
        assert.equal(summary.lastStage, 'spawn');
        assert.equal(summary.invalidEvents, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('primary Error identity survives all cleanup failures and later cleanup still runs', async () => {
    const { createFixtureArtifacts, createSmokeFailures } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'entry-recovery');
        const failures = createSmokeFailures(artifacts);
        const primary = Object.assign(new Error('PRIVATE_COOKIE'), {
            code: 'ETIMEDOUT',
            cause: new Error('PRIVATE_PATH'),
        });
        primary.cause.cause = primary;
        const actions: string[] = [];
        failures.primary(primary);
        await failures.cleanup('gateway-close', async () => {
            actions.push('close');
            throw new Error('PRIVATE_SECONDARY');
        });
        await failures.cleanup('profile-cleanup', async () => {
            actions.push('profiles');
        });
        assert.deepEqual(actions, ['close', 'profiles']);
        assert.throws(
            () => failures.finish(),
            (error) => error === primary,
        );
        const summary = await readFile(path.join(directory, 'entry-recovery.summary.json'), 'utf8');
        assert.doesNotMatch(summary, /PRIVATE/);
        const value = JSON.parse(summary);
        assert.equal(value.primary.error.code, 'ETIMEDOUT');
        assert.equal(value.secondary.length, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('cleanup-only failure fails with the first Error and diagnostic I/O failure is contained', async () => {
    const { createFixtureArtifacts, createSmokeFailures } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server', {
            append() {
                throw new Error('PRIVATE_IO');
            },
        });
        const failures = createSmokeFailures(artifacts);
        const first = new Error('cleanup');
        await failures.cleanup('gateway-close', async () => {
            throw first;
        });
        await failures.cleanup('profile-cleanup', async () => {});
        assert.throws(
            () => failures.finish(),
            (error) => error === first,
        );
        assert.equal(artifacts.snapshot().writeFailed, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('event and byte bounds leave a truncation marker without growing on repeated drops', async () => {
    const { createFixtureArtifacts } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server');
        for (let index = 0; index < 2100; index++)
            artifacts.gateway({
                stage: 'spawn',
                event: 'begin',
                outcome: 'started',
                timestampMs: index,
                durationMs: 0,
            });
        const stream = await readFile(path.join(directory, 'official-server.events.ndjson'));
        assert.ok(stream.byteLength <= 1_048_576);
        assert.match(stream.toString(), /"kind":"truncated"/);
        assert.ok(artifacts.snapshot().droppedEvents > 0);
        const size = stream.byteLength;
        artifacts.gateway({ stage: 'spawn', event: 'begin', outcome: 'started', timestampMs: 1, durationMs: 0 });
        assert.equal((await readFile(path.join(directory, 'official-server.events.ndjson'))).byteLength, size);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('dependency-free job index preserves prerequisite and second-smoke not-run states', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const entry = new URL('./smoke/fixture-ci.ts', import.meta.url);
        const initialized = spawnSync(process.execPath, [fileURLToPath(entry), 'init', directory], {
            encoding: 'utf8',
        });
        assert.equal(initialized.status, 0, initialized.stderr);
        const staged = spawnSync(
            process.execPath,
            [fileURLToPath(entry), 'stage', directory, 'official-server', initialized.stdout.trim()],
            { encoding: 'utf8' },
        );
        assert.equal(staged.status, 0, staged.stderr);
        const value = JSON.parse(await readFile(path.join(directory, 'job-index.json'), 'utf8'));
        assert.equal(value.stage, 'official-server');
        assert.equal(value.fixtures['entry-recovery'], 'not-run');
        assert.deepEqual(await readdir(directory), [
            'entry-recovery.events.ndjson',
            'entry-recovery.summary.json',
            'job-index.json',
            'official-server.events.ndjson',
            'official-server.summary.json',
        ]);
        for (const fixture of ['official-server', 'entry-recovery']) {
            const summary = JSON.parse(await readFile(path.join(directory, `${fixture}.summary.json`), 'utf8'));
            assert.equal(summary.state, 'not-run');
            assert.equal(summary.primary, null);
            assert.equal(summary.gatewayEvents, 0);
            assert.equal(await readFile(path.join(directory, `${fixture}.events.ndjson`), 'utf8'), '');
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('safe subscriber contains hostile payloads and writer failures with visible limitation evidence', async () => {
    const { createFixtureArtifacts } = await import('./smoke/fixture-artifacts.ts');
    const { subscribeFixtureDiagnostics } = await import('../src/adapters/fixture-diagnostics.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const artifacts = createFixtureArtifacts(directory, 'official-server', {
            append() {
                throw new Error('PRIVATE_WRITER');
            },
        });
        const stop = subscribeFixtureDiagnostics(
            (event) => artifacts.gateway(event),
            () => artifacts.rejected(),
        );
        try {
            const cyclic: Record<string, unknown> = { message: 'PRIVATE_MESSAGE' };
            cyclic.cause = cyclic;
            channel('debugging-cdp-targets.fixture').publish(cyclic);
            channel('debugging-cdp-targets.fixture').publish({
                stage: 'spawn',
                event: 'begin',
                outcome: 'started',
                timestampMs: 1,
                durationMs: 0,
            });
        } finally {
            stop();
        }
        artifacts.finish(false);
        const evidence = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.match(evidence, /"reason":"write-failed"/);
        assert.doesNotMatch(evidence, /PRIVATE/);
        assert.equal(artifacts.snapshot().writeFailed, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('standalone dependency-free initialization leaves both envelopes explicitly not-run after prerequisite failure', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const entry = path.join(directory, 'fixture-ci.mts');
        await copyFile(new URL('./smoke/fixture-ci.ts', import.meta.url), entry);
        const output = path.join(directory, 'output');
        const initialized = spawnSync(process.execPath, [entry, 'init', output], { encoding: 'utf8' });
        assert.equal(initialized.status, 0, initialized.stderr);
        // The actual next prerequisite exit stays observable; diagnostics do not fabricate smoke failure.
        const prerequisite = spawnSync(process.execPath, ['--eval', 'process.exit(23)']);
        assert.equal(prerequisite.status, 23);
        for (const label of ['official-server', 'entry-recovery']) {
            const summary = JSON.parse(await readFile(path.join(output, `${label}.summary.json`), 'utf8'));
            assert.equal(summary.state, 'not-run');
            assert.equal(summary.primary, null);
            assert.deepEqual(summary.secondary, []);
            assert.equal(summary.gatewayEvents, 0);
            assert.equal(summary.lastOperationId, null);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('shared preload and parent writers enforce the byte cap before the event cap', async () => {
    const { createFixtureArtifacts } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server');
        const preload = createFixtureArtifacts(directory, 'official-server', {
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const id = '12345678-1234-4234-8234-123456789012';
        const error = { name: 'Error', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', syscall: 'realpath', errno: -12345 };
        const event = {
            stage: 'resource-disposal',
            event: 'begin',
            outcome: 'started',
            timestampMs: 12345,
            durationMs: 0,
            entryId: id,
            operationId: id,
            originOperationId: id,
            requestId: id,
            connectionId: id,
            sessionId: id,
            pid: 12345,
            port: 54321,
            action: 'restart',
            phase: 'starting-official-server',
            reason: 'target-rollback-failed',
            attempt: 12345,
            count: 12345,
            pendingCount: 12345,
            resourceCount: 12345,
            budgetMs: 12345,
            remainingMs: 12345,
            stderrPresent: true,
            valid: true,
            available: true,
            exitCode: 12345,
            status: 'identity-changed',
            error: { ...error, cause: { ...error, cause: { ...error, cause: { ...error } } } },
        };
        for (let index = 0; index < 2200; index++) (index % 2 ? parent : preload).gateway(event);
        const evidence = await readFile(path.join(directory, 'official-server.events.ndjson'));
        assert.ok(evidence.byteLength <= 1_048_576);
        assert.match(evidence.toString(), /"kind":"truncated"/);
        assert.ok(evidence.toString().trim().split('\n').length < 2000);
        assert.ok(
            evidence
                .toString()
                .split('\n')
                .every((line) => Buffer.byteLength(line) <= 4096),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('preload lock contention is visible to the parent after stream shutdown', async () => {
    const { createFixtureArtifacts } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    try {
        const parent = createFixtureArtifacts(directory, 'official-server');
        const preload = createFixtureArtifacts(directory, 'official-server', {
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        const lock = path.join(directory, 'official-server.events.ndjson.lock');
        await mkdir(lock);
        preload.gateway({ stage: 'spawn', event: 'begin', outcome: 'started', timestampMs: 1, durationMs: 0 });
        await rmdir(lock);
        preload.finishStream();
        parent.finish(false);
        assert.equal(parent.snapshot().writeFailed, true);
        assert.match(
            await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'),
            /"reason":"write-failed"/,
        );
        await mkdir(lock);
        parent.finish(false);
        assert.equal(parent.snapshot().incomplete, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('failure job summary emits fixed labels and UUIDs without sensitive unknown values', async () => {
    const { fixtureJobIndex } = await import('./smoke/fixture-ci.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    const savedSummary = process.env.GITHUB_STEP_SUMMARY;
    try {
        const output = path.join(directory, 'summary.md');
        process.env.GITHUB_STEP_SUMMARY = output;
        fixtureJobIndex('init', directory);
        await writeFile(
            path.join(directory, 'official-server.summary.json'),
            JSON.stringify({
                state: 'failed',
                private: 'PRIVATE_TOKEN',
                primary: {
                    stage: 'PRIVATE_PATH',
                    operationId: 'PRIVATE_HOSTNAME',
                    error: { message: 'PRIVATE_COOKIE' },
                },
            }),
        );
        await fixtureJobIndex('summary', directory);
        const text = await readFile(output, 'utf8');
        assert.doesNotMatch(text, /PRIVATE/);
        assert.match(text, /Primary stage: unavailable; operation: unavailable/);
        assert.match(text, /entry-recovery: not-run/);
    } finally {
        if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
        else process.env.GITHUB_STEP_SUMMARY = savedSummary;
        await rm(directory, { recursive: true, force: true });
    }
});

test('original delivered gateway remains the child entry with source subscriber preload', async () => {
    const { createFixtureArtifacts, fixtureGatewayArguments, fixtureGatewayEnvironment } = await import(
        './smoke/fixture-artifacts.ts'
    );
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    const plugin = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-delivery-'));
    try {
        const delivered = new URL('../plugins/codex/debugging-cdp-targets/', import.meta.url);
        await cp(fileURLToPath(delivered), plugin, { recursive: true });
        const original = path.join(plugin, 'dist/mcp-bootstrap.mjs');
        assert.ok(
            !original.startsWith(fileURLToPath(new URL('..', import.meta.url))),
            'Delivered child must run outside repository coverage scope.',
        );
        assert.deepEqual(await readFile(original), await readFile(new URL('dist/mcp-bootstrap.mjs', delivered)));
        const defaultChild = spawnSync(process.execPath, fixtureGatewayArguments(original), {
            input: '',
            encoding: 'utf8',
            timeout: 20000,
        });
        assert.equal(defaultChild.status, 0, defaultChild.stderr);
        assert.deepEqual(await readdir(directory), []);
        const parent = createFixtureArtifacts(directory, 'official-server');
        const args = fixtureGatewayArguments(original, directory, 'official-server', parent.snapshot().collectionId);
        assert.equal(args[0], '--import');
        assert.equal(args[2], original);
        // The original dist child initializes/exits without a browser; preload receives its cleanup event.
        const child = spawnSync(process.execPath, args, {
            input: '',
            encoding: 'utf8',
            timeout: 20000,
            env: fixtureGatewayEnvironment(),
        });
        assert.equal(child.status, 0, child.stderr);
        const stream = await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8');
        assert.match(stream, /"stage":"gateway-cleanup"/);
        assert.doesNotMatch(stream, /stderr|stack|message|hostname/);
        assert.deepEqual(fixtureGatewayArguments('original.mjs'), ['original.mjs']);
    } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(plugin, { recursive: true, force: true });
    }
});

test('normal and truncated earlier collections are preserved and rejected without changing the new smoke failure', async () => {
    const { createFixtureArtifacts, createSmokeFailures } = await import('./smoke/fixture-artifacts.ts');
    const { fixtureJobIndex } = await import('./smoke/fixture-ci.ts');
    for (const truncated of [false, true]) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
        try {
            fixtureJobIndex('init', directory);
            const prior = createFixtureArtifacts(directory, 'official-server');
            for (let index = 0; index < (truncated ? 2001 : 1); index++)
                prior.gateway({
                    stage: 'gateway-cleanup',
                    event: 'end',
                    outcome: 'succeeded',
                    timestampMs: index,
                    durationMs: 0,
                    operationId: '11111111-1111-4111-8111-111111111111',
                });
            prior.finish(false);
            const before = await Promise.all(
                (await readdir(directory)).map(async (name) => [
                    name,
                    await readFile(path.join(directory, name), 'utf8'),
                ]),
            );
            assert.throws(() => fixtureJobIndex('init', directory), /fresh/i);
            const next = createFixtureArtifacts(directory, 'official-server');
            next.gateway({
                stage: 'spawn',
                event: 'begin',
                outcome: 'started',
                timestampMs: 1,
                durationMs: 0,
                operationId: '22222222-2222-4222-8222-222222222222',
            });
            const failures = createSmokeFailures(next);
            const primary = new Error('new smoke failure');
            failures.primary(primary);
            assert.throws(
                () => failures.finish(),
                (error) => error === primary,
            );
            assert.equal(next.snapshot().collectionRejected, true);
            assert.equal(next.snapshot().gatewayEvents, 0);
            assert.equal(next.snapshot().lastOperationId, null);
            assert.equal(next.snapshot().primary?.operationId, null);
            const after = await Promise.all(
                (await readdir(directory)).map(async (name) => [
                    name,
                    await readFile(path.join(directory, name), 'utf8'),
                ]),
            );
            assert.deepEqual(after, before);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
});

test('both original gateway smoke launches omit hostile inherited NODE_OPTIONS while retaining the explicit subscriber', async () => {
    const { createFixtureArtifacts, createFixtureGatewayClient, fixtureGatewayEnvironment } = await import(
        './smoke/fixture-artifacts.ts'
    );
    const mixedCase = { Node_Options: 'injected', NODE_OPTIONS: 'injected-again', PATH: 'preserved' };
    assert.deepEqual(fixtureGatewayEnvironment(mixedCase), { PATH: 'preserved' });
    assert.deepEqual(mixedCase, { Node_Options: 'injected', NODE_OPTIONS: 'injected-again', PATH: 'preserved' });
    for (const fixture of ['official-server', 'entry-recovery'] as const) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
        const plugin = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-delivery-'));
        const inherited = process.env.NODE_OPTIONS;
        try {
            const sentinel = path.join(directory, 'injected');
            const hostile = `data:text/javascript,${encodeURIComponent(`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)},'injected');`)}`;
            process.env.NODE_OPTIONS = `--import=${hostile}`;
            const artifacts = createFixtureArtifacts(directory, fixture);
            const delivered = new URL('../plugins/codex/debugging-cdp-targets/', import.meta.url);
            await cp(fileURLToPath(delivered), plugin, { recursive: true });
            const entry = path.join(plugin, 'dist/mcp-bootstrap.mjs');
            assert.ok(
                !entry.startsWith(fileURLToPath(new URL('..', import.meta.url))),
                'Delivered child must run outside repository coverage scope.',
            );
            assert.deepEqual(await readFile(entry), await readFile(new URL('dist/mcp-bootstrap.mjs', delivered)));
            const client = createFixtureGatewayClient(entry, directory, fixture, artifacts);
            await client.close();
            assert.equal(client.child.exitCode, 0);
            assert.ok(!(await readdir(directory)).includes('injected'));
            assert.match(
                await readFile(path.join(directory, `${fixture}.events.ndjson`), 'utf8'),
                /"stage":"gateway-cleanup"/,
            );
            assert.equal(process.env.NODE_OPTIONS, `--import=${hostile}`);
        } finally {
            if (inherited === undefined) delete process.env.NODE_OPTIONS;
            else process.env.NODE_OPTIONS = inherited;
            await rm(directory, { recursive: true, force: true });
            await rm(plugin, { recursive: true, force: true });
        }
    }
});

test('streamOnly BEGIN and completed progress are reconstructed for interrupted CI and persisted on failed first smoke', async () => {
    const { createFixtureArtifacts, createSmokeFailures } = await import('./smoke/fixture-artifacts.ts');
    const { fixtureJobIndex } = await import('./smoke/fixture-ci.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-test-'));
    const savedSummary = process.env.GITHUB_STEP_SUMMARY;
    try {
        fixtureJobIndex('init', directory);
        const parent = createFixtureArtifacts(directory, 'official-server');
        const preload = createFixtureArtifacts(directory, 'official-server', {
            streamOnly: true,
            collectionId: parent.snapshot().collectionId,
        });
        parent.begin('acceptance');
        const operationId = '22222222-2222-4222-8222-222222222222';
        preload.gateway({
            stage: 'spawn',
            event: 'begin',
            outcome: 'started',
            timestampMs: 1,
            durationMs: 0,
            operationId,
        });
        const output = path.join(directory, 'summary.md');
        process.env.GITHUB_STEP_SUMMARY = output;
        await fixtureJobIndex('summary', directory);
        const text = await readFile(output, 'utf8');
        assert.match(
            text,
            /Runtime boundary: spawn; operation: 22222222-2222-4222-8222-222222222222; gateway events: 1/,
        );
        assert.match(text, /official-server: running/);
        preload.gateway({
            stage: 'endpoint',
            event: 'end',
            outcome: 'succeeded',
            timestampMs: 2,
            durationMs: 1,
            operationId,
        });
        const failures = createSmokeFailures(parent);
        const primary = new Error('controlled first smoke failure');
        failures.primary(primary);
        assert.throws(
            () => failures.finish(),
            (error) => error === primary,
        );
        const summary = JSON.parse(await readFile(path.join(directory, 'official-server.summary.json'), 'utf8'));
        assert.equal(summary.lastStage, 'endpoint');
        assert.equal(summary.smokeStage, 'acceptance');
        assert.equal(summary.lastOperationId, operationId);
        assert.equal(summary.gatewayEvents, 2);
        assert.equal(summary.incomplete, true);
        assert.equal(summary.state, 'failed');
        assert.equal(summary.primary.runtimeStage, 'endpoint');
        assert.equal(summary.primary.operationId, operationId);
        const second = JSON.parse(await readFile(path.join(directory, 'entry-recovery.summary.json'), 'utf8'));
        assert.equal(second.state, 'not-run');
        assert.equal(second.primary, null);
        assert.equal(second.gatewayEvents, 0);
    } finally {
        if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
        else process.env.GITHUB_STEP_SUMMARY = savedSummary;
        await rm(directory, { recursive: true, force: true });
    }
});

test('actual fresh-process summary CLI renders running and finalized child evidence to stdout and GHA file', async () => {
    const { createFixtureArtifacts, createSmokeFailures } = await import('./smoke/fixture-artifacts.ts');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-cli-'));
    try {
        const entry = fileURLToPath(new URL('./smoke/fixture-ci.ts', import.meta.url));
        const init = spawnSync(process.execPath, [entry, 'init', directory], { encoding: 'utf8' });
        assert.equal(init.status, 0, init.stderr);
        const index = JSON.parse(await readFile(path.join(directory, 'job-index.json'), 'utf8'));
        const parent = createFixtureArtifacts(directory, 'official-server', { collectionId: index.collectionId });
        const child = createFixtureArtifacts(directory, 'official-server', {
            streamOnly: true,
            collectionId: index.collectionId,
        });
        child.gateway({
            stage: 'spawn',
            event: 'begin',
            outcome: 'started',
            timestampMs: 1,
            durationMs: 0,
            operationId: '22222222-2222-4222-8222-222222222222',
        });
        const summary = spawnSync(process.execPath, [entry, 'summary', directory, index.collectionId], {
            encoding: 'utf8',
        });
        assert.equal(summary.status, 0, summary.stderr);
        assert.match(init.stdout, /^[a-f0-9-]{36}\n$/);
        assert.match(summary.stdout, /official-server: running/);
        assert.match(
            summary.stdout,
            /Runtime boundary: spawn; operation: 22222222-2222-4222-8222-222222222222; gateway events: 1/,
        );
        const output = path.join(directory, 'gha-summary.md');
        const ghaEnvironment = {
            ...process.env,
            GITHUB_STEP_SUMMARY: output,
            DCT_FIXTURE_ARTIFACT_URL: 'https://github.com/owner/repository/actions/runs/123/artifacts/456',
        };
        const interruptedGha = spawnSync(process.execPath, [entry, 'summary', directory, index.collectionId], {
            encoding: 'utf8',
            env: ghaEnvironment,
        });
        assert.equal(interruptedGha.status, 0, interruptedGha.stderr);
        assert.match(await readFile(output, 'utf8'), /official-server: running/);
        assert.match(
            await readFile(output, 'utf8'),
            /Runtime boundary: spawn; operation: 22222222-2222-4222-8222-222222222222/,
        );
        parent.finish(false);
        const second = createFixtureArtifacts(directory, 'entry-recovery', { collectionId: index.collectionId });
        const failures = createSmokeFailures(second);
        failures.primary(new Error('controlled failure'));
        assert.throws(() => failures.finish());
        const gha = spawnSync(process.execPath, [entry, 'summary', directory, index.collectionId], {
            encoding: 'utf8',
            env: {
                ...process.env,
                GITHUB_STEP_SUMMARY: output,
                DCT_FIXTURE_ARTIFACT_URL: 'https://github.com/owner/repository/actions/runs/123/artifacts/456',
            },
        });
        assert.equal(gha.status, 0, gha.stderr);
        const text = await readFile(output, 'utf8');
        assert.match(text, /official-server: passed/);
        assert.match(text, /entry-recovery: failed/);
        assert.match(
            text,
            /Failure artifact.*https:\/\/github.com\/owner\/repository\/actions\/runs\/123\/artifacts\/456/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('actual refused init-stage-current-failure-summary sequence preserves earlier normal and truncated files', async () => {
    const { createFixtureArtifacts, createSmokeFailures } = await import('./smoke/fixture-artifacts.ts');
    for (const truncated of [false, true]) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-artifacts-cli-'));
        try {
            const entry = fileURLToPath(new URL('./smoke/fixture-ci.ts', import.meta.url));
            const initialized = spawnSync(process.execPath, [entry, 'init', directory], { encoding: 'utf8' });
            assert.equal(initialized.status, 0, initialized.stderr);
            const prior = createFixtureArtifacts(directory, 'official-server');
            for (let index = 0; index < (truncated ? 2001 : 1); index++)
                prior.gateway({
                    stage: 'gateway-cleanup',
                    event: 'end',
                    outcome: 'succeeded',
                    timestampMs: index,
                    durationMs: 0,
                    operationId: '11111111-1111-4111-8111-111111111111',
                });
            prior.finish(false);
            const names = await readdir(directory);
            const before = await Promise.all(names.map((name) => readFile(path.join(directory, name), 'utf8')));
            const refused = spawnSync(process.execPath, [entry, 'init', directory], { encoding: 'utf8' });
            assert.equal(refused.status, 1);
            assert.equal(refused.stdout, '');
            const stage = spawnSync(
                process.execPath,
                [entry, 'stage', directory, 'official-server', refused.stdout.trim()],
                { encoding: 'utf8' },
            );
            assert.equal(stage.status, 1);
            const current = createFixtureArtifacts(directory, 'official-server', {
                collectionId: refused.stdout.trim(),
            });
            const failures = createSmokeFailures(current);
            const primary = new Error('actual new failure');
            failures.primary(primary);
            assert.throws(
                () => failures.finish(),
                (error) => error === primary,
            );
            const summary = spawnSync(process.execPath, [entry, 'summary', directory, refused.stdout.trim()], {
                encoding: 'utf8',
            });
            assert.equal(summary.status, 0, summary.stderr);
            assert.match(summary.stdout, /Diagnostic limitation: current collection unavailable/);
            assert.doesNotMatch(
                summary.stdout,
                /11111111|passed|gateway-cleanup|gateway events: 2000|gateway events: 1/,
            );
            assert.deepEqual(
                await Promise.all(names.map((name) => readFile(path.join(directory, name), 'utf8'))),
                before,
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
});
