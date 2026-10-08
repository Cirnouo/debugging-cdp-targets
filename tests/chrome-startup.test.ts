import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const helper = () => import('./smoke/chrome-startup.ts');
const line = (source: string, severity: string, message: string) =>
    `[123:456:1010/123456.123456:${severity}:${source}(123)] ${message}\n`;

test('startup projection uses source-specific categories and never mistakes DBus or unknown errors for causes', async () => {
    const { projectChromeStartupText } = await helper();
    const input = [
        line('ozone_platform_x11.cc', 'ERROR', 'Missing X server or $DISPLAY'),
        line(
            'zygote_host_impl_linux.cc',
            'FATAL',
            'No usable sandbox! PRIVATE /private/profile https://private.invalid',
        ),
        line('devtools_http_handler.cc', 'ERROR', 'Cannot start http server for devtools.'),
        line('dbus/bus.cc', 'ERROR', 'Failed to connect to the bus: PRIVATE'),
        line('unknown.cc', 'ERROR', 'Missing X server or $DISPLAY'),
        'unstructured No usable sandbox! PRIVATE\n',
    ].join('');
    const projection = projectChromeStartupText(input, 1);
    assert.deepEqual(projection.reasons, ['x-display-unavailable', 'sandbox-unavailable', 'devtools-bind-failed']);
    assert.equal(projection.error, 4);
    assert.equal(projection.fatal, 1);
    assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|private|https:|dbus|unknown\.cc/);
    assert.deepEqual(projectChromeStartupText(line('dbus/bus.cc', 'ERROR', 'Failed to connect'), 1).reasons, []);
});

test('startup projection covers sandbox helper, zygote and singleton source messages without exposing interpolations', async () => {
    const { projectChromeStartupText } = await helper();
    const projection = projectChromeStartupText(
        [
            line(
                'zygote_host_impl_linux.cc',
                'ERROR',
                'Running as root without --no-sandbox is not supported. See PRIVATE',
            ),
            line('setuid_sandbox_host.cc', 'FATAL', 'The SUID sandbox helper binary is missing: /PRIVATE'),
            line(
                'zygote_host_impl_linux.cc',
                'FATAL',
                'Zygote process exited prematurely with exit code 123 (PRIVATE)',
            ),
            line('process_singleton_posix.cc', 'ERROR', 'Failed to create socket directory.'),
        ].join(''),
        2,
    );
    assert.deepEqual(projection.reasons, [
        'sandbox-root-disallowed',
        'sandbox-helper-invalid',
        'zygote-startup-failed',
        'singleton-startup-failed',
    ]);
    assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|123 \(/);
});

test('closed startup record rejects unknown keys, accessors, malformed arrays and unbounded counts without reading getters', async () => {
    const { projectChromeStartupText, validateBrowserStartupRecord } = await helper();
    const valid = projectChromeStartupText('', 1);
    const detached = validateBrowserStartupRecord(valid);
    assert.ok(detached && detached !== valid && detached.phase === 'log');
    assert.ok(Object.isFrozen(detached));
    assert.ok(Object.isFrozen(detached.reasons));
    for (const invalid of [
        { ...valid, raw: 'PRIVATE' },
        { ...valid, error: 4097 },
        { ...valid, error: NaN },
        { ...valid, launch: 0 },
        { ...valid, reasons: ['made-up'] },
        { ...valid, reasons: ['sandbox-unavailable', 'sandbox-unavailable'] },
        { ...valid, absent: 'true' },
        { ...valid, reasons: new Array(1) },
    ])
        assert.equal(validateBrowserStartupRecord(invalid), undefined);
    let reads = 0;
    assert.equal(
        validateBrowserStartupRecord(
            Object.defineProperty({ ...valid }, 'error', {
                get() {
                    reads++;
                    return 1;
                },
            }),
        ),
        undefined,
    );
    assert.equal(reads, 0);
    const array = new Proxy([], {
        get() {
            reads++;
            throw new Error('PRIVATE');
        },
    });
    assert.ok(validateBrowserStartupRecord({ ...valid, reasons: array }));
    assert.equal(reads, 0, 'Array validation must inspect data descriptors, not read properties.');
    assert.equal(
        validateBrowserStartupRecord(
            new Proxy(
                {},
                {
                    ownKeys() {
                        throw new Error('PRIVATE');
                    },
                },
            ),
        ),
        undefined,
    );
});

test('zygote CHECK launch failure matches its actual Chromium check prefix only at the researched site', async () => {
    const { projectChromeStartupText } = await helper();
    const message = 'Check failed: process.IsValid(). Failed to launch zygote process PRIVATE';
    assert.deepEqual(projectChromeStartupText(line('zygote_host_impl_linux.cc', 'FATAL', message), 1).reasons, [
        'zygote-startup-failed',
    ]);
    assert.deepEqual(projectChromeStartupText(line('unknown.cc', 'FATAL', message), 1).reasons, []);
    assert.deepEqual(
        projectChromeStartupText(line('zygote_host_impl_linux.cc', 'FATAL', 'Failed to launch zygote process'), 1)
            .reasons,
        [],
    );
});

test('private reader caps first/last ranges, distinguishes absence and rejects nonregular/aliased files', async () => {
    const { readChromeStartupLog } = await helper();
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-startup-reader-')));
    try {
        const file = path.join(directory, 'browser.log');
        const first = line('ozone_platform_x11.cc', 'ERROR', 'Missing X server or $DISPLAY');
        const last = line('devtools_http_handler.cc', 'ERROR', 'Cannot start http server for devtools.');
        await writeFile(file, `${first}${'PRIVATE'.repeat(50000)}\n${last}`);
        const projected = await readChromeStartupLog(file, 1);
        assert.equal(projected.truncated, true);
        assert.equal(projected.readFailed, false);
        assert.deepEqual(projected.reasons, ['x-display-unavailable', 'devtools-bind-failed']);
        assert.doesNotMatch(JSON.stringify(projected), /PRIVATE/);
        await writeFile(file, first);
        assert.equal((await readChromeStartupLog(file, 1)).error, 1, 'Overlapping ranges must not double count.');
        let inspections = 0;
        const raced = await readChromeStartupLog(file, 1, {
            inspect: async (owned) => {
                if (++inspections === 2) throw Object.assign(new Error('PRIVATE'), { code: 'ENOENT' });
                return lstat(owned);
            },
        });
        assert.equal(raced.absent, false, 'A disappearing observed file is a race, not initial absence.');
        assert.equal(raced.readFailed, true);
        assert.equal(raced.incomplete, true);
        const hardlink = path.join(directory, 'linked.log');
        await link(file, hardlink);
        assert.equal((await readChromeStartupLog(file, 1)).readFailed, true);
        await rm(hardlink);
        await writeFile(file, first.trimEnd());
        assert.equal((await readChromeStartupLog(file, 1)).incomplete, true);
        await writeFile(file, line('unknown.cc', 'ERROR', 'PRIVATE'.repeat(1500)));
        assert.equal((await readChromeStartupLog(file, 1)).incomplete, true);
        assert.equal((await readChromeStartupLog(path.join(directory, 'absent'), 1)).absent, true);
        assert.equal((await readChromeStartupLog(directory, 1)).readFailed, true);
        const alias = path.join(directory, 'alias');
        const actual = path.join(directory, 'actual');
        await mkdir(actual);
        await writeFile(path.join(actual, 'browser.log'), first);
        await symlink(actual, alias, 'junction');
        assert.equal((await readChromeStartupLog(path.join(alias, 'browser.log'), 1)).readFailed, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('current Chromium colon header is recognized and discarded partial lines remain explicit', async () => {
    const { projectChromeStartupText } = await helper();
    const colon = line('ozone_platform_x11.cc', 'ERROR', 'Missing X server or $DISPLAY').replace('(123)', ':123');
    assert.deepEqual(projectChromeStartupText(colon, 1).reasons, ['x-display-unavailable']);
    assert.equal(projectChromeStartupText('PRIVATE', 1).incomplete, true);
    assert.equal(projectChromeStartupText('\n'.repeat(4097), 1).incomplete, true);
});

test('unknown Objective-C++, header and C++ sites retain severity counts but no source or message fields', async () => {
    const { projectChromeStartupText } = await helper();
    const projection = projectChromeStartupText(
        [
            line('PRIVATE.mm', 'ERROR', 'Missing X server or $DISPLAY PRIVATE'),
            line('private/PRIVATE.h', 'FATAL', 'No usable sandbox! PRIVATE'),
            line('PRIVATE.cpp', 'ERROR', 'Cannot start http server for devtools. https://PRIVATE'),
            line('C:\\PRIVATE dir\\PRIVATE.hpp', 'ERROR', 'No usable sandbox! PRIVATE').replace('(123)', ':123'),
        ].join(''),
        1,
    );
    assert.equal(projection.error, 3);
    assert.equal(projection.fatal, 1);
    assert.deepEqual(projection.reasons, []);
    assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|private|\.mm|\.h|\.cpp|https:/);
});

test('restart samples before overwrite and scratch cleanup refuses a same-path replacement', async () => {
    const { createChromeStartupCapture } = await helper();
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-startup-restart-')));
    const evidence: unknown[] = [];
    const capture = await createChromeStartupCapture(true, parent, (record) => evidence.push(record));
    assert.ok(capture);
    const moved = `${capture.directory}-original`;
    try {
        const file = capture.newLog();
        assert.ok(file);
        await writeFile(file, line('ozone_platform_x11.cc', 'ERROR', 'Missing X server or $DISPLAY'));
        await capture.settled(() => writeFile(file, line('unknown.cc', 'INFO', 'PRIVATE')), true);
        assert.ok(JSON.stringify(evidence[0]).includes('x-display-unavailable'));
        assert.ok(!JSON.stringify(evidence[1]).includes('x-display-unavailable'));
        await rename(capture.directory, moved);
        await mkdir(capture.directory);
        await writeFile(path.join(capture.directory, 'sentinel'), 'PRIVATE');
        await capture.close(true);
        assert.equal(await readFile(path.join(capture.directory, 'sentinel'), 'utf8'), 'PRIVATE');
        assert.deepEqual(evidence.at(-1), {
            kind: 'browser-startup',
            phase: 'cleanup',
            retained: true,
            cleanupFailed: true,
        });
    } finally {
        await rm(capture.directory, { recursive: true, force: true });
        await rm(moved, { recursive: true, force: true });
        await rm(parent, { recursive: true, force: true });
    }
});

test('concurrent startup settlement samples its own launch instead of a pending peer', async () => {
    const { createChromeStartupCapture } = await helper();
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-startup-peers-')));
    const evidence: unknown[] = [];
    const capture = await createChromeStartupCapture(true, parent, (record, first) => {
        if (first) evidence.push(record);
    });
    assert.ok(capture);
    try {
        capture.newLog();
        const second = capture.newLog();
        assert.ok(second);
        await capture.settled(() => writeFile(second, line('unknown.cc', 'INFO', 'PRIVATE')), false, second);
        assert.equal(evidence.length, 1);
        assert.ok(JSON.stringify(evidence[0]).includes('"launch":2'));
        assert.ok(JSON.stringify(evidence[0]).includes('"absent":false'));
    } finally {
        await capture.close(true);
        await rm(parent, { recursive: true, force: true });
    }
});

test('controlled scratch stays outside profiles, capture failure preserves primary and live scratch is retained', async () => {
    const { createChromeStartupCapture } = await helper();
    const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-startup-owned-')));
    try {
        assert.equal(
            await createChromeStartupCapture(false, parent, () => assert.fail('Disabled observer called.')),
            undefined,
        );
        const evidence: unknown[] = [];
        const capture = await createChromeStartupCapture(true, parent, (value) => {
            evidence.push(value);
        });
        assert.ok(capture);
        const file = capture.newLog();
        assert.ok(file);
        assert.ok(!file.startsWith(`${parent}${path.sep}`));
        await writeFile(file, line('unknown.cc', 'INFO', 'PRIVATE'));
        const primary = new Error('original');
        await assert.rejects(
            capture.settled(async () => {
                throw primary;
            }),
            (error) => error === primary,
        );
        assert.equal(evidence.length, 1);
        await capture.close(false);
        assert.match(await readFile(file, 'utf8'), /PRIVATE/);
        await capture.close(true);
        await assert.rejects(readFile(file), { code: 'ENOENT' });
        const failing = await createChromeStartupCapture(
            true,
            parent,
            () => {
                throw new Error('PRIVATE observer');
            },
            {
                remove: async () => {
                    throw new Error('PRIVATE rm failure');
                },
            },
        );
        assert.ok(failing);
        failing.newLog();
        await assert.rejects(
            failing.settled(async () => {
                throw primary;
            }),
            (error) => error === primary,
        );
        await failing.close(true);
        // The injected failure cannot remove the fixture; clean its owned scratch explicitly.
        await rm(failing.directory, { recursive: true, force: true });
    } finally {
        await rm(parent, { recursive: true, force: true });
    }
});

test('display preflight uses inherited DISPLAY, ignored output and its own five-second bound only when controlled on Linux', async () => {
    const { checkChromeSmokeDisplay } = await helper();
    let calls = 0;
    const environment = { DISPLAY: ':PRIVATE', PRIVATE_TOKEN: 'secret' };
    const run = async (
        executable: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv; timeout: number; stdio: string },
    ) => {
        calls++;
        assert.equal(executable, 'xdpyinfo');
        assert.deepEqual(args, []);
        assert.deepEqual(options, { env: environment, timeout: 5000, stdio: 'ignore' });
        return { status: 0, available: true, timedOut: false };
    };
    assert.equal(await checkChromeSmokeDisplay(false, 'linux', environment, run), undefined);
    assert.equal(await checkChromeSmokeDisplay(true, 'darwin', environment, run), undefined);
    const success = await checkChromeSmokeDisplay(true, 'linux', environment, run);
    assert.deepEqual(success, {
        kind: 'browser-startup',
        phase: 'display',
        available: true,
        responsive: true,
        timedOut: false,
    });
    assert.equal(calls, 1);
    for (const result of [
        { status: 1, available: true, timedOut: false },
        { status: null, available: true, timedOut: true },
        { status: null, available: false, timedOut: false },
    ]) {
        const failed = await checkChromeSmokeDisplay(true, 'linux', environment, async () => result);
        assert.equal(failed?.responsive, false);
        assert.equal(failed?.timedOut, result.timedOut);
        assert.doesNotMatch(JSON.stringify(failed), /PRIVATE|secret/);
    }
});

test('controlled launch flags are explicit while ordinary launches stay byte-for-byte unchanged', async () => {
    const { createChromeSmokeLaunch } = await import('./smoke/chrome-host.ts');
    const ordinary = createChromeSmokeLaunch('/chrome', '/profiles/one', 'data:local', 'linux');
    const captured = createChromeSmokeLaunch('/chrome', '/profiles/one', 'data:local', 'linux', '/scratch/private.log');
    assert.ok(ordinary.launch.args);
    assert.deepEqual(captured.launch.args, [
        ...ordinary.launch.args.slice(0, -1),
        '--enable-logging',
        '--log-file=/scratch/private.log',
        'data:local',
    ]);
    assert.deepEqual({ ...captured, launch: ordinary.launch }, ordinary);
});

test('bounded collector and actual summary CLI accept only closed startup projection and preserve runtime attribution', async () => {
    const { projectChromeStartupText } = await helper();
    const { createFixtureArtifacts, readFixtureProgress } = await import('./smoke/fixture-artifacts.ts');
    const { fixtureJobIndex } = await import('./smoke/fixture-ci.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-startup-collector-')));
    try {
        fixtureJobIndex('init', directory);
        const artifacts = createFixtureArtifacts(directory, 'official-server');
        const evidence = projectChromeStartupText(
            line('devtools_http_handler.cc', 'ERROR', 'Cannot start http server for devtools.'),
            1,
        );
        artifacts.startup(evidence);
        artifacts.startup({ ...evidence, raw: 'PRIVATE' });
        artifacts.startup({
            kind: 'browser-startup',
            phase: 'display',
            available: true,
            responsive: true,
            timedOut: false,
        });
        artifacts.startup({ kind: 'browser-startup', phase: 'cleanup', retained: true, cleanupFailed: false });
        const progress = readFixtureProgress(directory, 'official-server');
        assert.equal(progress.gatewayEvents, 0);
        assert.equal(progress.lastStage, null);
        assert.deepEqual(progress.browserStartup[0], evidence);
        assert.equal(progress.browserStartup.length, 3);
        assert.equal(progress.invalidEvents, 1);
        const summary = spawnSync(
            process.execPath,
            ['tests/smoke/fixture-ci.ts', 'summary', directory, artifacts.snapshot().collectionId ?? ''],
            {
                encoding: 'utf8',
                env: { ...process.env, GITHUB_STEP_SUMMARY: '', PRIVATE_SENTINEL: 'PRIVATE' },
            },
        );
        assert.equal(summary.status, 0, summary.stderr);
        assert.match(summary.stdout, /Chrome startup slot 1: categories=devtools-bind-failed/);
        assert.match(summary.stdout, /readFailed=false/);
        assert.match(summary.stdout, /X display preflight: available=true; responsive=true; timedOut=false/);
        assert.match(summary.stdout, /Private startup scratch: retained=true; cleanupFailed=false/);
        assert.doesNotMatch(summary.stdout, /PRIVATE|browser\.log|https:\/\//);
        artifacts.finish(false);
        assert.doesNotMatch(await readFile(path.join(directory, 'official-server.events.ndjson'), 'utf8'), /PRIVATE/);
        for (let index = 0; index < 2001; index++) artifacts.startup(evidence);
        assert.ok(Buffer.byteLength(await readFile(path.join(directory, 'official-server.events.ndjson'))) <= 1048576);
        assert.equal(artifacts.snapshot().truncated, true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
