import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    closeSync,
    existsSync,
    fstatSync,
    lstatSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readSync,
    realpathSync,
    rmSync,
    symlinkSync,
    truncateSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
    type AssessmentFileIo,
    checkFirstStartAssessmentFiles,
    evaluateFirstStartAssessmentAdmission,
    postcheckFirstStartAssessmentFiles,
    readFirstStartAssessmentAdmission,
    writeAssessmentOutput,
} from './smoke/first-start-assessment-ci.ts';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const roundId = '11111111-1111-4111-8111-111111111111';
const collectionId = '66666666-6666-4666-8666-666666666666';
const source = { eventSha: sha, sourceSha: sha, sourceTree: tree, roundId, runId: 123, slot: 1 };
const binding = { source, collectionId };
const files = [
    'job-index.json',
    'official-server.events.ndjson',
    'official-server.summary.json',
    'entry-recovery.events.ndjson',
    'entry-recovery.summary.json',
];
function context() {
    return {
        eventName: 'workflow_dispatch',
        repository: 'Cirnouo/debugging-cdp-targets',
        ref: 'refs/heads/fix/chrome-startup-stall',
        sha,
        workflow: 'CI',
        workflowRef: 'Cirnouo/debugging-cdp-targets/.github/workflows/ci.yaml@refs/heads/fix/chrome-startup-stall',
        runnerOs: 'Linux',
        runId: '123',
        runAttempt: '1',
        job: 'ubuntu-first-start-assessment-1',
        enabled: 'true',
        startupStudy: 'false',
        readaheadStudy: 'false',
        roundId,
        sourceSha: sha,
        sourceTree: tree,
    };
}
function event() {
    return {
        ref: 'fix/chrome-startup-stall',
        repository: { full_name: 'Cirnouo/debugging-cdp-targets' },
        inputs: {
            'ubuntu-first-start-assessment': 'true',
            'ubuntu-startup-study': 'false',
            'ubuntu-readahead-study': 'false',
            'assessment-round-id': roundId,
            'assessment-source-sha': sha,
            'assessment-source-tree': tree,
        },
    };
}
function admission() {
    return { context: context(), event: event(), checkout: { sha, tree, objectTree: tree, clean: true }, slot: '1' };
}
function environment() {
    return {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REPOSITORY: 'Cirnouo/debugging-cdp-targets',
        GITHUB_REF: 'refs/heads/fix/chrome-startup-stall',
        GITHUB_SHA: sha,
        GITHUB_WORKFLOW: 'CI',
        GITHUB_WORKFLOW_REF:
            'Cirnouo/debugging-cdp-targets/.github/workflows/ci.yaml@refs/heads/fix/chrome-startup-stall',
        RUNNER_OS: 'Linux',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'ubuntu-first-start-assessment-1',
        GITHUB_EVENT_PATH: path.resolve('event.json'),
        DCT_ASSESSMENT_ENABLED: 'true',
        DCT_ASSESSMENT_STARTUP_STUDY: 'false',
        DCT_ASSESSMENT_READAHEAD_STUDY: 'false',
        DCT_ASSESSMENT_ROUND_ID: roundId,
        DCT_ASSESSMENT_SOURCE_SHA: sha,
        DCT_ASSESSMENT_SOURCE_TREE: tree,
    };
}

// Removing source/context/job checks would admit a stale or differently assigned launch.
test('admission binds exact source, tree, attempt and literal slot job identity', () => {
    assert.deepEqual(evaluateFirstStartAssessmentAdmission(admission()), { result: 'admitted', source });
    for (const slot of ['0', '7', '01', '1\n', 1, '$(id)', undefined]) {
        assert.equal(evaluateFirstStartAssessmentAdmission({ ...admission(), slot }).result, 'ineligible');
    }
    for (const [key, value] of [
        ['runAttempt', '2'],
        ['runId', '0'],
        ['runId', '9007199254740992'],
        ['repository', 'foreign/repo'],
        ['workflow', 'foreign'],
        ['workflowRef', 'foreign/repo/.github/workflows/ci.yaml@refs/heads/fix/chrome-startup-stall'],
        ['eventName', 'push'],
        ['runnerOs', 'Windows'],
        ['job', 'ubuntu-first-start-assessment-2'],
        ['enabled', 'false'],
        ['startupStudy', 'true'],
        ['readaheadStudy', 'true'],
        ['sourceSha', 'c'.repeat(40)],
        ['sourceTree', '0'.repeat(40)],
        ['roundId', 'TOKEN\n'],
    ]) {
        assert.equal(
            evaluateFirstStartAssessmentAdmission({ ...admission(), context: { ...context(), [key as string]: value } })
                .result,
            'ineligible',
            String(key),
        );
    }
    assert.equal(
        evaluateFirstStartAssessmentAdmission({
            ...admission(),
            checkout: { sha, tree, objectTree: tree, clean: false },
        }).result,
        'ineligible',
    );
});

test('dispatch fields are checked when supplied without inventing absent payload evidence', () => {
    assert.equal(evaluateFirstStartAssessmentAdmission({ ...admission(), event: {} }).result, 'admitted');
    assert.equal(
        evaluateFirstStartAssessmentAdmission({ ...admission(), event: { ref: 'refs/heads/fix/chrome-startup-stall' } })
            .result,
        'admitted',
    );
    for (const value of [{ ref: 'main' }, { repository: {} }, { inputs: { 'assessment-source-sha': tree } }]) {
        assert.equal(evaluateFirstStartAssessmentAdmission({ ...admission(), event: value }).result, 'ineligible');
    }
    for (const workflow of ['CI', 'ci.yaml', '.github/workflows/ci.yaml']) {
        assert.equal(evaluateFirstStartAssessmentAdmission({ ...admission(), event: { workflow } }).result, 'admitted');
    }
    assert.equal(
        evaluateFirstStartAssessmentAdmission({ ...admission(), event: { workflow: 'foreign' } }).result,
        'ineligible',
    );
    const quality = { ...admission(), context: { ...context(), job: 'quality' }, slot: 'quality' };
    assert.deepEqual(evaluateFirstStartAssessmentAdmission(quality), { result: 'admitted', source: null });
});

const nonstringWorkflows: unknown[] = [
    ['CI'],
    [['CI']],
    ['ci.yaml'],
    [['ci.yaml']],
    ['.github/workflows/ci.yaml'],
    [['.github/workflows/ci.yaml']],
    null,
    true,
    false,
    0,
    {},
    [],
];

test('optional dispatch workflow never coerces nonstring JSON values into approved spellings', () => {
    for (const workflow of nonstringWorkflows) {
        assert.deepEqual(
            evaluateFirstStartAssessmentAdmission({ ...admission(), event: { workflow } }),
            { result: 'ineligible', source: null },
            JSON.stringify(workflow),
        );
    }
});

test('native admission reader rejects nonstring workflows after decoding dispatch bytes', () => {
    const read = (workflow: unknown) =>
        readFirstStartAssessmentAdmission('1', environment(), {
            readEvent: () => Buffer.from(JSON.stringify({ ...event(), workflow })),
            checkout: () => admission().checkout,
        });
    for (const workflow of nonstringWorkflows) {
        assert.deepEqual(read(workflow), { result: 'ineligible', source: null }, JSON.stringify(workflow));
    }
    for (const workflow of ['CI', 'ci.yaml', '.github/workflows/ci.yaml']) {
        assert.deepEqual(read(workflow), { result: 'admitted', source });
    }
});

test('hostile admission objects never evaluate getters or proxies and reject malformed event bytes', () => {
    let reads = 0;
    const hostile = Object.defineProperty(context(), 'roundId', { get: () => ++reads });
    const proxy = new Proxy(context(), {
        getOwnPropertyDescriptor: () => {
            throw Error('TOKEN');
        },
    });
    for (const value of [null, [], new Date(), hostile, proxy, { ...context(), [Symbol('TOKEN')]: true }]) {
        assert.equal(evaluateFirstStartAssessmentAdmission({ ...admission(), context: value }).result, 'ineligible');
    }
    assert.equal(reads, 0);
    let acquired = 0;
    const io = {
        readEvent: () => {
            acquired++;
            return Buffer.from(JSON.stringify(event()));
        },
        checkout: () => {
            acquired++;
            return admission().checkout;
        },
    };
    assert.deepEqual(readFirstStartAssessmentAdmission('1', environment(), io), { result: 'admitted', source });
    assert.equal(acquired, 2);
    acquired = 0;
    assert.equal(readFirstStartAssessmentAdmission('01', environment(), io).result, 'ineligible');
    assert.equal(acquired, 0);
    for (const body of [Buffer.from([0xff]), Buffer.alloc(262_145), Buffer.from('{'), 'not bytes']) {
        assert.equal(
            readFirstStartAssessmentAdmission('1', environment(), { ...io, readEvent: () => body }).result,
            'unavailable',
        );
    }
});

const ids = {
    entryId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    operationId: '44444444-4444-4444-8444-444444444444',
    requestId: '55555555-5555-4555-8555-555555555555',
};
function summary(fixture: string) {
    const writer = {
        attempts: 1,
        dataAttempts: 0,
        markerAttempts: 0,
        metadataReserved: 6,
        scannedBytes: 100,
        exhausted: false,
        releaseFailed: false,
        writeFailed: false,
        selfReportWriteUnavailable: true,
    };
    const record = (slot: string, status: string, fields: object = {}) => ({
        kind: 'linux-first-start-capture',
        slot,
        status,
        atMs: 1,
        ...ids,
        ...fields,
    });
    const armed = fixture === 'official-server';
    return {
        schemaVersion: 1,
        fixture,
        collectionId,
        state: armed ? 'passed' : 'not-run',
        run: 123,
        attempt: 1,
        commit: sha,
        platform: 'linux',
        collectionRejected: false,
        firstStartCaptureArmed: armed,
        firstStartCapture: armed
            ? [
                  record('selection', 'armed'),
                  record('root-binding', 'bound', { pid: 123, rootStartTicks: 200 }),
                  record('first-start-outcome', 'succeeded'),
                  record('retention-decision', 'discarded', {
                      metrics: { discarded: 4, admitted: 1, completed: 1, pending: 1, skipped: 5 },
                  }),
                  record('six-slot-status', 'complete', {
                      slots: [
                          'complete',
                          'not-admitted',
                          'not-admitted',
                          'not-admitted',
                          'not-admitted',
                          'not-admitted',
                      ],
                  }),
                  record('limitations', 'no-close-gate', {
                      creationObservation: {
                          stats: 'available',
                          sourceAttempts: 1,
                          comparisons: 1,
                          tokens: 1,
                          retained: 1,
                          omitted: 0,
                          capped: false,
                          disabled: false,
                          revoked: true,
                          producerCpu: 'unmeasured',
                      },
                  }),
                  record('writer-state', 'partial', {
                      reason: 'incomplete',
                      metrics: { sinkCalls: 7, sinkFailed: 0, callbackMs: 1, records: 7, serializedBytes: 200 },
                  }),
                  record('observer-terminal', 'complete'),
              ]
            : [],
        firstStartCaptureOmitted: 0,
        firstStartCaptureLimitations: armed ? ['self-report-write-unavailable'] : [],
        firstStartCaptureWriter: armed
            ? {
                  ...writer,
                  events: 8,
                  bytes: 200,
                  counts: {
                      ordinary: { events: 0, bytes: 0 },
                      capture: { events: 8, bytes: 200 },
                      control: { events: 0, bytes: 0 },
                      marker: { events: 0, bytes: 0 },
                  },
                  controlSlots: [],
              }
            : null,
        firstStartCaptureWriterChild: armed ? { kind: 'first-start-writer-cost', ...writer } : null,
        writeFailed: false,
        truncated: false,
        incomplete: armed,
        invalidEvents: 0,
        droppedEvents: 0,
        diagnosticAbsent: false,
        events: armed ? 8 : 0,
        gatewayEvents: armed ? 1 : 0,
        linuxStartupWaitOmitted: 0,
        readaheadStudyOmitted: 0,
    };
}
function fixture() {
    const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dct-assessment-')));
    const write = (name: string, value: unknown) =>
        writeFileSync(path.join(directory, name), `${JSON.stringify(value)}\n`);
    write('job-index.json', {
        schemaVersion: 1,
        collectionId,
        stage: 'official-server',
        fixtures: { 'official-server': 'running', 'entry-recovery': 'not-run' },
        files,
    });
    write('official-server.summary.json', summary('official-server'));
    write('entry-recovery.summary.json', summary('entry-recovery'));
    writeFileSync(path.join(directory, 'official-server.events.ndjson'), 'deliberately not parsed\n');
    writeFileSync(path.join(directory, 'entry-recovery.events.ndjson'), '');
    return { directory, write, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}
function observedIo() {
    const reads: string[] = [];
    let metadata = 0;
    const handles = new Map<number, string>();
    const io: AssessmentFileIo = {
        lstat: (file) => {
            metadata++;
            return lstatSync(file, { bigint: true });
        },
        realpath: (file) => {
            metadata++;
            return realpathSync(file);
        },
        open: (file) => {
            const fd = openSync(file, 'r');
            handles.set(fd, file);
            return fd;
        },
        fstat: (fd) => {
            metadata++;
            return fstatSync(fd, { bigint: true });
        },
        read: (fd, buffer) => {
            reads.push(path.basename(handles.get(fd) ?? 'unknown'));
            return readSync(fd, buffer, 0, buffer.length, 0);
        },
        close: (fd) => {
            handles.delete(fd);
            closeSync(fd);
        },
    };
    return { io, reads, metadata: () => metadata, handles };
}

test('owned current five files acquire each JSON once and postcheck never acquires bodies', () => {
    const f = fixture();
    const observed = observedIo();
    try {
        const checked = checkFirstStartAssessmentFiles(f.directory, binding, 'complete', observed.io);
        assert.equal(checked.eligibility, 'complete');
        assert.match(checked.metadataToken ?? '', /^[a-f0-9]{64}$/);
        assert.deepEqual(checked.files, files);
        assert.deepEqual(observed.reads, [
            'job-index.json',
            'official-server.summary.json',
            'entry-recovery.summary.json',
        ]);
        assert.equal(
            postcheckFirstStartAssessmentFiles(f.directory, binding, checked.metadataToken, observed.io),
            true,
        );
        assert.equal(observed.reads.length, 3);
        assert.ok(observed.metadata() <= 48);
        assert.ok(checked.metadataCalls <= 30);
        assert.ok(checked.acquiredBytes <= 1_179_651);
        assert.equal(observed.handles.size, 0);
        assert.equal(
            postcheckFirstStartAssessmentFiles(
                f.directory,
                { source: { ...source, slot: 2 }, collectionId },
                checked.metadataToken,
            ),
            false,
        );
        writeFileSync(path.join(f.directory, 'official-server.events.ndjson'), 'changed');
        assert.equal(postcheckFirstStartAssessmentFiles(f.directory, binding, checked.metadataToken), false);
    } finally {
        f.dispose();
    }
});

test('wrong collection/source/index file set cannot authorize even a partial upload', () => {
    const f = fixture();
    try {
        for (const patch of [
            { collectionId: roundId },
            { commit: tree },
            { run: 124 },
            { attempt: 2 },
            { platform: 'win32' },
            { collectionRejected: true },
        ]) {
            f.write('entry-recovery.summary.json', { ...summary('entry-recovery'), ...patch });
            assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'partial').eligibility, 'unavailable');
        }
        f.write('entry-recovery.summary.json', summary('entry-recovery'));
        f.write('job-index.json', {
            schemaVersion: 1,
            collectionId,
            stage: 'official-server',
            fixtures: { 'official-server': 'running', 'entry-recovery': 'not-run' },
            files: [...files, '../foreign'],
        });
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'partial').eligibility, 'unavailable');
    } finally {
        f.dispose();
    }
});

test('failed closed current collection is partial only and missing files never become complete', () => {
    const f = fixture();
    try {
        f.write('official-server.summary.json', { ...summary('official-server'), state: 'failed' });
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'complete').eligibility, 'unavailable');
        const partial = checkFirstStartAssessmentFiles(f.directory, binding, 'partial');
        assert.equal(partial.eligibility, 'partial');
        assert.equal(partial.metadataToken, null);
        assert.deepEqual(partial.files, files);
        f.write('official-server.summary.json', { ...summary('official-server'), state: 'running' });
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'partial').eligibility, 'unavailable');
        rmSync(path.join(f.directory, 'entry-recovery.summary.json'));
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'partial').eligibility, 'unavailable');
    } finally {
        f.dispose();
    }
});

test('complete postflight rejects malformed capture and event-size contradictions', () => {
    const f = fixture();
    try {
        f.write('official-server.summary.json', { ...summary('official-server'), firstStartCapture: [] });
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'complete').eligibility, 'unavailable');
        f.write('official-server.summary.json', summary('official-server'));
        writeFileSync(path.join(f.directory, 'entry-recovery.events.ndjson'), 'foreign');
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'complete').eligibility, 'unavailable');
        writeFileSync(path.join(f.directory, 'entry-recovery.events.ndjson'), '');
        truncateSync(path.join(f.directory, 'official-server.events.ndjson'), 1_048_577);
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'complete').eligibility, 'unavailable');
    } finally {
        f.dispose();
    }
});

test('single short/extra JSON reads, metadata changes and oversized bodies refuse without retry', () => {
    for (const change of ['short', 'extra', 'metadata', 'oversize']) {
        const f = fixture();
        const observed = observedIo();
        try {
            if (change === 'oversize') truncateSync(path.join(f.directory, 'job-index.json'), 65_537);
            const io = {
                ...observed.io,
                read: (fd: number, buffer: Buffer) => {
                    const size = observed.io.read(fd, buffer);
                    if (change === 'metadata') writeFileSync(path.join(f.directory, 'job-index.json'), '{}');
                    return change === 'short' ? size - 1 : change === 'extra' ? size + 1 : size;
                },
            };
            assert.equal(
                checkFirstStartAssessmentFiles(f.directory, binding, 'complete', io).eligibility,
                'unavailable',
            );
            assert.ok(observed.reads.length <= 1);
            assert.equal(observed.handles.size, 0);
        } finally {
            f.dispose();
        }
    }
});

test('directory links and nonregular fixed files refuse metadata postcheck', () => {
    const f = fixture();
    const link = `${f.directory}-link`;
    try {
        symlinkSync(f.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
        assert.equal(checkFirstStartAssessmentFiles(link, binding, 'complete').eligibility, 'unavailable');
        rmSync(path.join(f.directory, 'entry-recovery.events.ndjson'));
        symlinkSync(
            path.join(f.directory, 'official-server.events.ndjson'),
            path.join(f.directory, 'entry-recovery.events.ndjson'),
        );
        assert.equal(checkFirstStartAssessmentFiles(f.directory, binding, 'complete').eligibility, 'unavailable');
    } finally {
        rmSync(link, { force: true });
        f.dispose();
    }
});

test('fixed output transport attempts one bounded write and never retries partial or throwing writes', () => {
    const lines: string[] = [];
    assert.equal(
        writeAssessmentOutput('metadata-token', 'a'.repeat(64), (line) => {
            lines.push(line);
            return Buffer.byteLength(line);
        }),
        true,
    );
    assert.deepEqual(lines, [`metadata-token=${'a'.repeat(64)}\n`]);
    let calls = 0;
    for (const write of [
        () => 0,
        () => {
            throw Error('EPIPE TOKEN');
        },
    ]) {
        assert.equal(
            writeAssessmentOutput('safe-to-continue', 'true', (line) => {
                calls++;
                assert.ok(Buffer.byteLength(line) <= 128);
                return write();
            }),
            false,
        );
    }
    assert.equal(calls, 2);
    for (const [field, value] of [
        ['metadata-token', 'a\nattack=true'],
        ['safe-to-continue', 'false'],
        ['foreign', 'true'],
    ]) {
        assert.equal(
            writeAssessmentOutput(field, value, () => {
                throw Error('must not write');
            }),
            false,
        );
    }
});

test('preflight revalidates the entire file set after sequential acquisition', () => {
    const f = fixture();
    try {
        const checked = checkFirstStartAssessmentFiles(f.directory, binding, 'complete');
        assert.equal(checked.eligibility, 'complete');
        const observed = observedIo();
        const raced = {
            ...observed.io,
            read(fd: number, buffer: Buffer) {
                const count = observed.io.read(fd, buffer);
                if (observed.reads.length === 3)
                    writeFileSync(path.join(f.directory, 'official-server.events.ndjson'), 'changed');
                return count;
            },
        };
        assert.equal(
            checkFirstStartAssessmentFiles(f.directory, binding, 'complete', raced).eligibility,
            'unavailable',
        );
    } finally {
        f.dispose();
    }
});

test('postcheck revalidates earlier metadata after checking the last fixed path', () => {
    const f = fixture();
    try {
        const stable = checkFirstStartAssessmentFiles(f.directory, binding, 'complete');
        const postIo = observedIo();
        const postRaced = {
            ...postIo.io,
            lstat(file: string) {
                const metadata = postIo.io.lstat(file);
                if (path.basename(file) === 'entry-recovery.summary.json')
                    writeFileSync(path.join(f.directory, 'official-server.events.ndjson'), 'later change');
                return metadata;
            },
        };
        assert.equal(postcheckFirstStartAssessmentFiles(f.directory, binding, stable.metadataToken, postRaced), false);
    } finally {
        f.dispose();
    }
});

test('native CLI quality rejects conflicts without acquisition and bounds event and git I/O', () => {
    const f = fixture();
    try {
        const eventFile = path.join(f.directory, 'dispatch.json');
        const logFile = path.join(f.directory, 'git-io.jsonl');
        const preload = path.join(f.directory, 'git-boundary.mjs');
        writeFileSync(eventFile, JSON.stringify(event()));
        writeFileSync(
            preload,
            `import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
childProcess.execFileSync = (executable, args, options) => {
    if (executable !== 'git' || options.shell !== false || options.timeout !== 2000 || options.maxBuffer !== 8192 ||
        Object.keys(options.env).some((key) => key.startsWith('GIT_'))) throw Error('Invalid boundary');
    appendFileSync(process.env.DCT_TEST_GIT_LOG, JSON.stringify(args) + '\\n');
    if (args[0] === 'status') return '';
    if (args.join(' ') === 'rev-parse --verify HEAD') return '${sha}\\n';
    if (args[0] === 'rev-parse' && args[1] === '--verify' &&
        (args[2] === 'HEAD^{tree}' || args[2] === '${sha}^{tree}')) return '${tree}\\n';
    throw Error('Unexpected git invocation');
};
syncBuiltinESMExports();
`,
        );
        const run = (extra: Record<string, string>) =>
            spawnSync(
                process.execPath,
                [
                    '--import',
                    pathToFileURL(preload).href,
                    path.resolve('tests/smoke/first-start-assessment-ci.ts'),
                    'quality',
                ],
                {
                    env: {
                        ...process.env,
                        ...environment(),
                        GITHUB_JOB: 'quality',
                        GITHUB_EVENT_PATH: eventFile,
                        DCT_TEST_GIT_LOG: logFile,
                        GIT_DIR: 'foreign-private-TOKEN',
                        ...extra,
                    },
                    encoding: 'utf8',
                    timeout: 10_000,
                },
            );
        const conflicting = run({
            DCT_ASSESSMENT_ENABLED: 'false',
            DCT_ASSESSMENT_STARTUP_STUDY: 'true',
            DCT_ASSESSMENT_READAHEAD_STUDY: 'true',
        });
        assert.equal(conflicting.status, 1);
        assert.doesNotMatch(conflicting.stderr, /TOKEN/);
        assert.equal(existsSync(logFile), false);
        const valid = run({});
        assert.equal(valid.status, 0, valid.stderr);
        assert.deepEqual(
            readFileSync(logFile, 'utf8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line)),
            [
                ['rev-parse', '--verify', 'HEAD'],
                ['rev-parse', '--verify', 'HEAD^{tree}'],
                ['rev-parse', '--verify', `${sha}^{tree}`],
                ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'],
            ],
        );
        truncateSync(eventFile, 262_145);
        assert.equal(run({}).status, 1);
        assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 4);
        for (const workflow of nonstringWorkflows) {
            writeFileSync(eventFile, JSON.stringify({ ...event(), workflow }));
            assert.equal(run({}).status, 1, JSON.stringify(workflow));
        }
        for (const workflow of ['CI', 'ci.yaml', '.github/workflows/ci.yaml']) {
            writeFileSync(eventFile, JSON.stringify({ ...event(), workflow }));
            const admitted = run({});
            assert.equal(admitted.status, 0, admitted.stderr);
        }
    } finally {
        f.dispose();
    }
});

test('separate CLI pre-upload and postcheck communicate only through existing bounded output fields', () => {
    const f = fixture();
    try {
        const output = path.join(f.directory, 'github-output');
        writeFileSync(output, '');
        const run = (command: string, extra: Record<string, string> = {}) =>
            spawnSync(
                process.execPath,
                [
                    path.resolve('tests/smoke/first-start-assessment-ci.ts'),
                    command,
                    f.directory,
                    '--assessment-slot',
                    '1',
                ],
                {
                    env: {
                        ...process.env,
                        ...environment(),
                        GITHUB_OUTPUT: output,
                        DCT_ASSESSMENT_COLLECTION_ID: collectionId,
                        ...extra,
                    },
                    encoding: 'utf8',
                    timeout: 10_000,
                },
            );
        const pre = run('pre-upload');
        assert.equal(pre.status, 0, pre.stderr);
        const fd = openSync(output, 'r');
        const bytes = Buffer.alloc(128);
        const count = readSync(fd, bytes, 0, bytes.length, 0);
        closeSync(fd);
        const line = bytes.subarray(0, count).toString('utf8');
        assert.match(line, /^metadata-token=[a-f0-9]{64}\n$/);
        const token = line.slice('metadata-token='.length).trim();
        writeFileSync(output, '');
        assert.equal(run('postcheck', { DCT_ASSESSMENT_METADATA_TOKEN: token }).status, 0);
        const after = openSync(output, 'r');
        const resultBytes = Buffer.alloc(128);
        const resultCount = readSync(after, resultBytes, 0, resultBytes.length, 0);
        closeSync(after);
        assert.equal(resultBytes.subarray(0, resultCount).toString('utf8'), 'safe-to-continue=true\n');
        assert.equal(run('postcheck', { DCT_ASSESSMENT_METADATA_TOKEN: 'a'.repeat(64) }).status, 1);
        f.write('official-server.summary.json', { ...summary('official-server'), state: 'failed' });
        writeFileSync(output, '');
        assert.equal(run('partial-upload').status, 0);
        assert.equal(readFileSync(output, 'utf8'), 'partial-eligible=true\n');
        assert.equal(run('postcheck', { DCT_ASSESSMENT_METADATA_TOKEN: token }).status, 1);
        assert.equal(run('pre-upload', { GITHUB_OUTPUT: path.join(f.directory, 'absent-output') }).status, 1);
    } finally {
        f.dispose();
    }
});

test('maximum JSON bodies reserve precisely three sentinel bytes without a fourth body read', () => {
    const f = fixture();
    const observed = observedIo();
    try {
        for (const [name, maximum] of [
            ['job-index.json', 65_536],
            ['official-server.summary.json', 1_048_576],
            ['entry-recovery.summary.json', 65_536],
        ] as const) {
            const body = readFileSync(path.join(f.directory, name));
            writeFileSync(path.join(f.directory, name), Buffer.concat([body, Buffer.alloc(maximum - body.length, 32)]));
        }
        const buffers: number[] = [];
        const result = checkFirstStartAssessmentFiles(f.directory, binding, 'complete', {
            ...observed.io,
            read(fd, buffer) {
                buffers.push(buffer.length);
                return observed.io.read(fd, buffer);
            },
        });
        assert.equal(result.eligibility, 'complete');
        assert.deepEqual(buffers, [65_537, 1_048_577, 65_537]);
        assert.equal(result.acquiredBytes, 1_179_651);
        assert.equal(postcheckFirstStartAssessmentFiles(f.directory, binding, result.metadataToken, observed.io), true);
        assert.equal(observed.metadata(), 38);
        assert.equal(observed.reads.length, 3);
    } finally {
        f.dispose();
    }
});
