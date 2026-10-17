import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFileSync, writeSync } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';
import { fixtureJobIndex } from './smoke/fixture-ci.ts';

// Run the actual CLI with only external I/O replaced. Validators, collector and capture run.
async function installStudyBoundary() {
    const trace: { event: string; detail?: unknown }[] = [];
    const note = (event: string, detail?: unknown) => trace.push({ event, detail });
    const traceFile = process.env.STUDY_TRACE;
    assert.ok(traceFile);
    process.on('exit', () => writeFileSync(traceFile, JSON.stringify(trace)));
    Object.defineProperty(process, 'platform', { value: process.env.STUDY_PLATFORM ?? 'linux' });
    Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true });
    process.kill = (pid, signal) => {
        note('native-signal', { pid, signal });
        return true;
    };
    const entryId = '11111111-1111-4111-8111-111111111111';
    let target: Record<string, unknown> | undefined;
    let directory: string | undefined;
    let launchCount = 0;
    let operation: Record<string, unknown> | undefined;
    const deleted = new Set<string>();
    const failure = process.env.STUDY_FAILURE;
    const assessment = process.argv.includes('--first-start-assessment');
    let rawTicks = '12345';
    const procText = (file: string) => {
        assert.ok(target?.processId === 4100, 'Native proc reads require the current simulated owned target.');
        if (file === '/proc/stat') return 'btime 1700000000\n';
        assert.equal(file, '/proc/4100/stat');
        return `4100 (chrome child ) name) S ${Array(18).fill('0').join(' ')} ${rawTicks} ${Array(30).fill('0').join(' ')}\n`;
    };
    let readaheadValue = 256;
    let createArtifacts: typeof import('./smoke/fixture-artifacts.ts').createFixtureArtifacts | undefined;
    let gatewayArtifacts: ReturnType<typeof import('./smoke/fixture-artifacts.ts').createFixtureArtifacts> | undefined;
    let startIdentity: Record<string, unknown> | undefined;
    const enoent = () => Object.assign(new Error('Not found'), { code: 'ENOENT' });
    const scratchIdentity = { dev: 7, ino: 8, isDirectory: () => true, isSymbolicLink: () => false };
    const privateFs = {
        ...filesystem,
        async open(file: string, flags: string) {
            assert.equal(flags, 'r');
            const text = Buffer.from(procText(file));
            note('native-proc-open', file);
            let position = 0;
            let closed = false;
            return {
                async read(buffer: Buffer, offset: number, length: number, requestedPosition: null) {
                    assert.equal(closed, false);
                    assert.equal(requestedPosition, null);
                    assert.ok(length > 0 && length <= (file === '/proc/stat' ? 262_145 : 16_385));
                    const bytesRead = text.copy(buffer, offset, position, position + length);
                    position += bytesRead;
                    note('native-proc-read', { file, bytesRead });
                    return { bytesRead, buffer };
                },
                async close() {
                    closed = true;
                    note('native-proc-close', file);
                },
            };
        },
        async readlink(file: string) {
            assert.equal(file, '/proc/4100/exe');
            note('native-readlink', file);
            return '/synthetic/chrome';
        },
        async access(file: string) {
            note('executable-access', file);
            if (failure === 'preparation') throw new Error('Executable preparation failed.');
        },
        async stat(file: string) {
            note('executable-stat', file);
            if (failure === 'preload-late-metadata' && file === '/synthetic/chrome')
                await new Promise((resolve) => setTimeout(resolve, 350));
            return { isFile: () => true, dev: 2049n, ino: 1n };
        },
        async mkdtemp(prefix: string) {
            const folder = prefix.includes('dct-chrome-startup-') ? '/synthetic/startup' : '/synthetic/smoke';
            note('scratch-create', folder);
            return folder;
        },
        async realpath(file: string) {
            note('realpath', file);
            if (failure === 'preload-late-canonical' && file === '/synthetic/chrome')
                await new Promise((resolve) => setTimeout(resolve, 350));
            if (file === '/sys/dev/block/8:1') return '/sys/devices/disk/block/sda/sda1';
            if (file === '/sys/dev/block/8:0') return '/sys/devices/disk/block/sda';
            return file;
        },
        async readdir(file: string) {
            return file.endsWith('/sda1') ? ['partition'] : [];
        },
        async lstat(file: string) {
            note('scratch-inspect', file);
            if (file.endsWith('.log')) throw enoent();
            if (deleted.has(file)) throw enoent();
            if (file.includes('profile-')) return { isDirectory: () => true };
            return scratchIdentity;
        },
        async rm(file: string) {
            note('scratch-remove', file);
        },
    };
    function reply(request: Record<string, unknown>) {
        note('request', { method: request.method, ...(isRecord(request.params) ? request.params : {}) });
        if (request.method === 'initialize') return { serverInfo: { name: 'boundary-gateway', version: '0.1.0' } };
        if (request.method === 'tools/list')
            return { tools: ['list_pages', 'get_css_styles', 'list_extensions'].map((name) => ({ name })) };
        if (request.method !== 'tools/call') return {};
        assert.ok(isRecord(request.params));
        const { name, arguments: args } = request.params;
        assert.ok(isRecord(args));
        const text = (text: string) => ({ content: [{ type: 'text', text }] });
        if (name === 'dct_connection_status') {
            if (args.include)
                return {
                    structuredContent: {
                        isolation: { mode: 'data-dir', path: directory, state: 'held', cleanup: 'delete-on-release' },
                    },
                };
            return { structuredContent: { entryId, connections: target ? [target] : [] } };
        }
        if (name === 'dct_connection_start') {
            launchCount++;
            assert.ok(isRecord(args.isolation) && isRecord(args.isolation.directory));
            directory = `/synthetic/smoke/${args.isolation.directory.name}`;
            target = {
                entryId,
                connectionId: `22222222-2222-4222-8222-${String(launchCount).padStart(12, '0')}`,
                sessionId: `33333333-3333-4333-8333-${String(launchCount).padStart(12, '0')}`,
                status: 'active',
                targetKind: 'chrome',
                processId: 4100,
                port: 19222,
            };
            operation = { state: 'succeeded', result: target };
            if (gatewayArtifacts) {
                startIdentity = {
                    entryId,
                    connectionId: target.connectionId,
                    sessionId: target.sessionId,
                    operationId: '44444444-4444-4444-8444-444444444444',
                };
                gatewayArtifacts.gateway({
                    ...startIdentity,
                    stage: 'operation-route',
                    event: 'decision',
                    outcome: 'observed',
                    action: 'start',
                    requestId: args.requestId,
                    timestampMs: 1,
                    durationMs: 0,
                });
                if (assessment) {
                    gatewayArtifacts.firstStartCapture({
                        kind: 'linux-first-start-capture',
                        slot: 'selection',
                        status: 'armed',
                        atMs: 0,
                        ...startIdentity,
                        requestId:
                            failure === 'foreign-selection' ? '88888888-8888-4888-8888-888888888888' : args.requestId,
                    });
                }
                gatewayArtifacts.gateway({
                    ...startIdentity,
                    stage: 'spawn',
                    event: 'decision',
                    outcome: 'observed',
                    reason: 'acquired',
                    pid: 4100,
                    timestampMs: 2,
                    durationMs: 0,
                });
            }
            if (failure === 'start') {
                assert.ok(directory);
                deleted.add(directory);
                target = undefined;
                operation = { state: 'failed', error: { message: 'First readiness failed.' } };
            }
            return { structuredContent: { operationId: '44444444-4444-4444-8444-444444444444' } };
        }
        if (name === 'dct_connection_stop') {
            if (failure === 'normal-close-pending') {
                note('normal-close-pending');
                // Model provider termination of this private synthetic fixture only.
                // A pending response never supplies target-exit or terminal evidence.
                setImmediate(() => {
                    note('provider-termination');
                    process.exit(23);
                });
                return;
            }
            if (failure === 'cleanup' || failure === 'profile-and-cleanup') throw new Error('Normal Close failed.');
            assert.ok(directory);
            if (failure !== 'profile-cleanup') deleted.add(directory);
            operation = { state: 'succeeded', result: { ...target, status: 'idle' } };
            if (gatewayArtifacts && startIdentity)
                gatewayArtifacts.gateway({
                    entryId,
                    connectionId: startIdentity.connectionId,
                    originOperationId: startIdentity.operationId,
                    stage: 'directory-lease',
                    event: 'end',
                    outcome: 'released',
                    phase: 'resource-cleanup',
                    timestampMs: 3,
                    durationMs: 0,
                });
            target = undefined;
            return { structuredContent: { operationId: '44444444-4444-4444-8444-444444444444' } };
        }
        if (name === 'dct_operation_wait') return { structuredContent: { complete: true, cursor: 1, operation } };
        if (!args._dct) throw new Error('Official tools require routing.');
        if (name === 'list_pages')
            return text(`12: data:text/html,<title>${launchCount === 1 ? 'FIRST' : 'SECOND'}</title> [selected]`);
        if (name === 'select_page') return text('selected');
        if (name === 'take_snapshot') return text('uid=heading-1 heading "Isolated smoke"');
        if (name === 'get_css_styles') return text('color: rgb(12, 34, 56)');
        if (name === 'list_extensions') return text('[]');
        throw new Error(`Unexpected tool ${name}`);
    }
    function spawn(executable: string, args: string[], options: unknown) {
        if (['ps', 'lsof', 'getconf'].includes(executable)) {
            assert.ok(target?.processId === 4100, 'Native commands require the current simulated owned target.');
            note('native-command', { executable, args, options });
            let output: string;
            if (executable === 'ps') {
                assert.deepEqual(args, ['-ww', '-axo', 'pid=,ppid=,uid=,lstart=,comm=']);
                output = '4100 1 1000 Tue Nov 14 22:15:23 2023 /synthetic/chrome\n';
            } else if (executable === 'getconf') {
                assert.deepEqual(args, ['CLK_TCK']);
                output = '100\n';
            } else if (args.includes('txt')) {
                assert.deepEqual(args, ['-a', '-p', '4100', '-d', 'txt', '-FfDin']);
                output = 'p4100\nftxt\nD0x801\ni1\nn/synthetic/chrome\n';
            } else {
                assert.deepEqual(args, ['-nP', '-iTCP:19222', '-sTCP:LISTEN', '-Fpn']);
                output = `p${failure === 'native-listener-foreign' ? 4200 : 4100}\nn127.0.0.1:19222\n`;
            }
            const child = Object.assign(new EventEmitter(), {
                stdin: null,
                stdout: new PassThrough(),
                stderr: new PassThrough(),
                exitCode: null as number | null,
                signalCode: null,
                kill: () => {
                    assert.fail('The immediately completed native inspection child should not be killed.');
                },
                unref: () => {},
            });
            queueMicrotask(() => {
                child.stdout.end(output);
                child.stderr.end();
                child.exitCode = 0;
                child.emit('exit', 0, null);
                child.emit('close', 0, null);
            });
            return child;
        }
        note('spawn', { executable, args, options });
        if (executable === '/usr/bin/sudo') {
            const stdout = new PassThrough();
            const child = Object.assign(new EventEmitter(), {
                stdout,
                stderr: new PassThrough(),
                stdin: new Writable({
                    write(chunk, _encoding, done) {
                        const assigned = Number(String(chunk).trim());
                        if (failure !== 'readahead-write-failure') readaheadValue = assigned;
                        note('readahead-write', assigned);
                        queueMicrotask(() => {
                            stdout.write(chunk);
                            stdout.end();
                            child.emit('close', failure === 'readahead-write-failure' ? 1 : 0, null);
                        });
                        done();
                    },
                }),
            });
            return child;
        }
        if (failure === 'readahead-success' || assessment) {
            const preload = args.find((argument) => argument.includes('fixture-preload.ts?'));
            assert.ok(preload && createArtifacts);
            const query = new URL(preload).searchParams;
            const output = query.get('directory');
            assert.ok(output);
            gatewayArtifacts = createArtifacts(output, 'official-server', {
                streamOnly: true,
                collectionId: query.get('collectionId'),
                firstStartCapture: assessment,
            });
            assert.equal(gatewayArtifacts.snapshot().collectionRejected, false);
        }
        const child = Object.assign(new EventEmitter(), {
            exitCode: null as number | null,
            signalCode: null,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: new Writable({
                write(chunk, _encoding, done) {
                    const request: unknown = JSON.parse(String(chunk));
                    assert.ok(isRecord(request));
                    if (request.id !== undefined) {
                        let response: Record<string, unknown>;
                        try {
                            response = { result: reply(request) };
                        } catch (error) {
                            assert.ok(error instanceof Error);
                            response = { error: { code: -32000, message: error.message } };
                        }
                        if (response.result !== undefined || response.error !== undefined)
                            queueMicrotask(() =>
                                child.stdout.write(
                                    `${JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response })}\n`,
                                ),
                            );
                    } else note('notify', request.method);
                    done();
                },
                final(done) {
                    if (!assessment)
                        gatewayArtifacts?.readahead({
                            kind: 'linux-readahead-study',
                            phase: 'observer',
                            outcome: 'verified',
                            clock: 'gateway',
                            assignedKb: 1024,
                            startedMs: 4,
                            endedMs: 4,
                            cost: 'complete',
                            reads: 0,
                            bytes: 0,
                        });
                    if (assessment && gatewayArtifacts && startIdentity) {
                        const selected = trace.find(
                            (item) =>
                                item.event === 'request' &&
                                isRecord(item.detail) &&
                                item.detail.name === 'dct_connection_start',
                        )?.detail;
                        assert.ok(isRecord(selected) && isRecord(selected.arguments));
                        const requestId = selected.arguments.requestId;
                        const receipt = (slot: string, status: string, fields: object = {}) =>
                            gatewayArtifacts?.firstStartCapture({
                                kind: 'linux-first-start-capture',
                                slot,
                                status,
                                atMs: 1,
                                ...startIdentity,
                                requestId,
                                ...fields,
                            });
                        receipt('first-start-outcome', failure === 'start' ? 'failed' : 'succeeded');
                        receipt('retention-decision', failure === 'start' ? 'retained' : 'discarded', {
                            metrics: { discarded: 1, admitted: 1, completed: 1, pending: 0, skipped: 5 },
                        });
                        receipt('six-slot-status', 'complete', {
                            slots: [
                                'complete',
                                'not-admitted',
                                'not-admitted',
                                'not-admitted',
                                'not-admitted',
                                'not-admitted',
                            ],
                        });
                        receipt('limitations', 'no-close-gate', {
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
                        });
                        receipt('writer-state', 'partial', {
                            reason: 'incomplete',
                            metrics: { sinkCalls: 7, sinkFailed: 0, callbackMs: 1, records: 7, serializedBytes: 200 },
                        });
                        if (failure !== 'missing-observer-terminal') receipt('observer-terminal', 'complete');
                        gatewayArtifacts.finishStream();
                    }
                    const code = failure === 'gateway-exit' ? 7 : 0;
                    note('gateway-exit', code);
                    child.exitCode = code;
                    child.stdout.end();
                    queueMicrotask(() => {
                        child.emit('exit', code);
                        child.emit('close', code);
                    });
                    done();
                },
            }),
        });
        return child;
    }
    Object.defineProperty(globalThis, '__studyBoundary', {
        value: {
            privateFs,
            async readaheadRead(file: string) {
                if (failure === 'readahead-io') return { bytes: 0, limitation: 'permission' };
                if (failure === 'preload-late-initialization-read' && file.endsWith('/sda1/dev'))
                    await new Promise((resolve) => setTimeout(resolve, 350));
                if (failure === 'preload-late-read' && file.endsWith('/stat')) {
                    await new Promise((resolve) => setTimeout(resolve, 350));
                    note('late-read-settled');
                }
                let text: string;
                if (file.endsWith('/sda1/dev')) text = '8:1';
                else if (file.endsWith('/sda/dev')) text = '8:0';
                else if (file.endsWith('/partition')) text = '1';
                else if (file.endsWith('/read_ahead_kb')) text = String(readaheadValue);
                else if (file.endsWith('/rotational')) text = '0';
                else if (file.endsWith('/stat')) text = '1 0 8 2 0 0 0 0 0 2 2';
                else throw new Error('Missing bounded fixture read.');
                text += '\n';
                return { bytes: Buffer.byteLength(text), text };
            },
            childProcess: {
                ...childProcess,
                spawn,
                execFileSync(executable: string, args: string[]) {
                    assert.equal(executable, 'git');
                    note('admission-git', args);
                    if (args[0] === 'status') return failure === 'dirty-source' ? ' M synthetic\n' : '';
                    return args[2] === 'HEAD' ? `${'a'.repeat(40)}\n` : `${'b'.repeat(40)}\n`;
                },
                spawnSync(...args: unknown[]) {
                    note('display-preflight', args);
                    return { status: 0 };
                },
            },
            path: path.posix,
            writeControl(fd: number, line: string) {
                assert.equal(fd, 1);
                const value: unknown = JSON.parse(line);
                note('control-write', value);
                assert.ok(isRecord(value));
                const controlFailure = process.env.STUDY_CONTROL_FAILURE || failure;
                if (controlFailure === `${value.phase}-partial`) return writeSync(fd, line.slice(0, 8));
                if (controlFailure === `${value.phase}-epipe`)
                    throw Object.assign(new Error('synthetic pipe'), { code: 'EPIPE' });
                return writeSync(fd, line);
            },
            async readChromeSmokeProfile(fixture: unknown) {
                note('profile-probe', fixture);
                if (failure === 'profile' || failure === 'profile-and-cleanup')
                    throw new Error('Profile observation failed.');
                return `${directory}/Default`;
            },
        },
    });
    globalThis.fetch = async (url) => {
        note('endpoint', url);
        assert.equal(String(url), 'http://127.0.0.1:19222/json/version');
        if (failure === 'native-q-change') rawTicks = '12346';
        return new Response(
            JSON.stringify({
                Browser: failure === 'version' ? 'Chrome/148.0.0.0' : 'Chrome/154.0.8037.93',
                webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/browser/fixture',
            }),
            { status: 200 },
        );
    };
    const virtual = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
    registerHooks({
        resolve(specifier, context, next) {
            const parent = context.parentURL ?? '';
            const privateModule =
                /\/(?:official-server|chrome-host|chrome-startup|linux-readahead-study|linux-chrome-external-close|platform-process)\.ts$/.test(
                    parent,
                );
            let source: string | undefined;
            if (privateModule && specifier === 'node:fs/promises')
                source =
                    "export * from 'node:fs/promises'; export default globalThis.__studyBoundary.privateFs; export const { access, stat, mkdtemp, realpath, readdir, lstat, rm, open, readlink } = globalThis.__studyBoundary.privateFs;";
            if (parent.endsWith('/linux-readahead-study.ts') && specifier === './linux-startup-wait.ts') {
                const actual = next(specifier, context).url;
                source =
                    'export * from ' +
                    JSON.stringify(actual) +
                    '; export const readLinuxStartupFile = globalThis.__studyBoundary.readaheadRead;';
            }
            if (privateModule && specifier === 'node:path') source = 'export default globalThis.__studyBoundary.path;';
            if (specifier === 'node:child_process')
                source =
                    "export * from 'node:child_process'; export default globalThis.__studyBoundary.childProcess; export const { spawn, spawnSync, execFileSync } = globalThis.__studyBoundary.childProcess;";
            if (parent.endsWith('/official-server.ts') && specifier === 'node:fs')
                source = "export * from 'node:fs'; export const writeSync = globalThis.__studyBoundary.writeControl;";
            if (parent.endsWith('/chrome-host.ts') && specifier === './chrome-profile-probe.ts')
                source = 'export const readChromeSmokeProfile = globalThis.__studyBoundary.readChromeSmokeProfile;';
            if (source && !parent.startsWith('data:')) return { url: virtual(source), shortCircuit: true };
            return next(specifier, context);
        },
    });
    createArtifacts = (await import('./smoke/fixture-artifacts.ts')).createFixtureArtifacts;
}

if (process.env.STUDY_TRACE) {
    await installStudyBoundary();
} else {
    interface Invocation {
        status: number | null;
        stdout: string;
        stderr: string;
        trace: { event: string; detail?: unknown }[];
        summary: Record<string, unknown> | undefined;
        recovery: Record<string, unknown> | undefined;
    }

    async function invoke(
        args: string[],
        options: {
            collection?: 'valid' | 'refused';
            platform?: string;
            failure?: string;
            failedFirstStartCapture?: boolean;
            assessment?: boolean;
            assessmentEnvironment?: Record<string, string>;
            controlFailure?: string;
            ordinaryAdmission?: string;
            ordinaryCi?: boolean;
        } = {},
    ): Promise<Invocation> {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-study-regression-'));
        try {
            const traceFile = path.join(folder, 'trace.json');
            const diagnostics = path.join(folder, 'diagnostics');
            const collection = options.collection ? await fixtureJobIndex('init', diagnostics) : undefined;
            const eventFile = path.join(folder, 'dispatch.json');
            writeFileSync(eventFile, '{}');
            const diagnosticsArgs = options.collection
                ? [
                      '--diagnostics',
                      diagnostics,
                      '--collection-id',
                      options.collection === 'refused' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : String(collection),
                  ]
                : [];
            const child = spawnSync(
                process.execPath,
                [
                    '--import',
                    import.meta.url,
                    fileURLToPath(new URL('./smoke/official-server.ts', import.meta.url)),
                    ...diagnosticsArgs,
                    ...args,
                ],
                {
                    encoding: 'utf8',
                    timeout: 15_000,
                    env: {
                        ...process.env,
                        NODE_OPTIONS: '',
                        DCT_SMOKE_CHROME_EXECUTABLE: '/synthetic/chrome',
                        STUDY_TRACE: traceFile,
                        STUDY_PLATFORM: options.platform ?? 'linux',
                        STUDY_FAILURE: options.failure ?? '',
                        STUDY_CONTROL_FAILURE: options.controlFailure ?? '',
                        GITHUB_ACTIONS: options.ordinaryCi ? 'true' : 'false',
                        DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION: options.ordinaryAdmission ?? '',
                        DCT_SMOKE_FAILED_FIRST_START_CAPTURE: options.failedFirstStartCapture ? '1' : '0',
                        ...(options.assessment
                            ? {
                                  GITHUB_EVENT_NAME: 'workflow_dispatch',
                                  GITHUB_REPOSITORY: 'Cirnouo/debugging-cdp-targets',
                                  GITHUB_REF: 'refs/heads/fix/chrome-startup-stall',
                                  GITHUB_SHA: 'a'.repeat(40),
                                  GITHUB_WORKFLOW: 'CI',
                                  GITHUB_WORKFLOW_REF:
                                      'Cirnouo/debugging-cdp-targets/.github/workflows/ci.yaml@refs/heads/fix/chrome-startup-stall',
                                  RUNNER_OS: 'Linux',
                                  GITHUB_RUN_ID: '42',
                                  GITHUB_RUN_ATTEMPT: '1',
                                  GITHUB_JOB: 'ubuntu-first-start-assessment-1',
                                  GITHUB_EVENT_PATH: eventFile,
                                  DCT_ASSESSMENT_ENABLED: 'true',
                                  DCT_ASSESSMENT_STARTUP_STUDY: 'false',
                                  DCT_ASSESSMENT_READAHEAD_STUDY: 'false',
                                  DCT_ASSESSMENT_ROUND_ID: '77777777-7777-4777-8777-777777777777',
                                  DCT_ASSESSMENT_SOURCE_SHA: 'a'.repeat(40),
                                  DCT_ASSESSMENT_SOURCE_TREE: 'b'.repeat(40),
                              }
                            : {}),
                        ...options.assessmentEnvironment,
                    },
                },
            );
            assert.ifError(child.error);
            const trace: unknown = JSON.parse(await readFile(traceFile, 'utf8').catch(() => assert.fail(child.stderr)));
            assert.ok(Array.isArray(trace) && trace.every((item) => isRecord(item) && typeof item.event === 'string'));
            const envelope = async (label: string) => {
                if (!options.collection) return;
                const value: unknown = JSON.parse(
                    await readFile(path.join(diagnostics, `${label}.summary.json`), 'utf8'),
                );
                assert.ok(isRecord(value));
                return value;
            };
            return {
                status: child.status,
                stdout: child.stdout,
                stderr: child.stderr,
                trace,
                summary: await envelope('official-server'),
                recovery: await envelope('entry-recovery'),
            };
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    }

    function calls(result: Invocation, name: string) {
        return result.trace.filter(
            (event) => event.event === 'request' && isRecord(event.detail) && event.detail.name === name,
        );
    }
    const study = (arm: string) => ['--allow-gui', '--startup-study', '--chrome-file-logging', arm];
    const assess = ['--allow-gui', '--first-start-assessment', '--assessment-slot', '1'];
    function controls(result: Invocation) {
        return result.trace.filter((item) => item.event === 'control-write').map((item) => item.detail);
    }

    test('ordinary Linux CI control maps the already acquired result without a second admission read', async () => {
        for (const [supplied, expected] of [
            ['admitted', 'admitted'],
            ['ineligible', 'ineligible'],
            ['unavailable', 'unavailable'],
            ['PRIVATE_UNTRUSTED_VALUE', 'unavailable'],
            ['', 'unavailable'],
        ] as const) {
            const result = await invoke(['--allow-gui'], {
                collection: 'valid',
                ordinaryCi: true,
                ordinaryAdmission: supplied,
            });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(calls(result, 'dct_connection_start').length, 2);
            assert.equal(calls(result, 'dct_connection_stop').length, 2);
            const [admission, terminal] = controls(result);
            assert.ok(isRecord(admission) && isRecord(terminal));
            assert.equal(controls(result).length, 2);
            assert.equal(admission.result, expected);
            assert.equal(admission.source, null);
            assert.equal(terminal.source, null);
            assert.equal(terminal.configured, false, 'Presentation-only admitted cannot arm capture.');
            assert.equal(terminal.selection, 'not-observed');
            assert.equal(terminal.fixtureOutcome, 'passed');
            assert.deepEqual(terminal.cleanup, { targetClosed: true, gatewayExited: true, profileDeleted: true });
            assert.equal(result.trace.filter((item) => item.event === 'admission-git').length, 0);
            assert.doesNotMatch(result.stdout, /PRIVATE_UNTRUSTED_VALUE/);
            const spawned = result.trace.find((item) => item.event === 'spawn')?.detail;
            assert.ok(isRecord(spawned) && isRecord(spawned.options) && isRecord(spawned.options.env));
            assert.equal(spawned.options.env.DCT_SMOKE_FIRST_START_CAPTURE_ADMISSION, undefined);
        }
    });

    test('ordinary control partial writes and EPIPE preserve both starts and original smoke exits', async () => {
        for (const failure of ['admission-partial', 'admission-epipe', 'terminal-partial', 'terminal-epipe']) {
            const result = await invoke(['--allow-gui'], {
                collection: 'valid',
                ordinaryCi: true,
                ordinaryAdmission: 'admitted',
                controlFailure: failure,
            });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(calls(result, 'dct_connection_start').length, 2);
            assert.equal(calls(result, 'dct_connection_stop').length, 2);
            assert.equal(controls(result).length, 2);
            assert.equal(result.summary?.state, 'passed');
            assert.equal(result.trace.filter((item) => item.event === 'admission-git').length, 0);
        }
        const failed = await invoke(['--allow-gui'], {
            collection: 'valid',
            ordinaryCi: true,
            ordinaryAdmission: 'admitted',
            failure: 'profile-and-cleanup',
            controlFailure: 'terminal-epipe',
        });
        assert.notEqual(failed.status, 0);
        assert.match(failed.stderr, /Error: Profile observation failed/);
        assert.doesNotMatch(failed.stderr, /synthetic pipe|First-start assessment evidence/);
        assert.equal(calls(failed, 'dct_connection_stop').length, 1);
        assert.equal(failed.trace.filter((item) => item.event === 'gateway-exit').length, 1);
    });

    test('assessment rejects conflicts and requires native source admission and accepted collection before resources', async () => {
        for (const args of [
            [...assess, '--first-start-assessment'],
            [...assess, '--assessment-slot', '1'],
            [...assess.slice(0, -1), 'quality'],
            [...assess.slice(0, -1), '7'],
            [...assess, '--startup-study', '--chrome-file-logging', 'on'],
            [...assess, '--chrome-file-logging', 'off'],
            [...assess, '--readahead-kb', '128'],
            ['--allow-gui', '--assessment-slot', '1'],
        ]) {
            const result = await invoke(args, { collection: 'valid', assessment: true });
            assert.notEqual(result.status, 0);
            assert.equal(calls(result, 'dct_connection_start').length, 0);
            assert.ok(
                !result.trace.some((item) => ['executable-access', 'spawn', 'scratch-create'].includes(item.event)),
            );
        }
        for (const options of [
            {},
            { collection: 'refused' as const },
            { collection: 'valid' as const, platform: 'win32' },
            { collection: 'valid' as const, failedFirstStartCapture: true },
            { collection: 'valid' as const, failure: 'dirty-source' },
            { collection: 'valid' as const, assessmentEnvironment: { GITHUB_JOB: 'quality' } },
            { collection: 'valid' as const, assessmentEnvironment: { GITHUB_RUN_ATTEMPT: '2' } },
        ]) {
            const result = await invoke(assess, { ...options, assessment: true });
            assert.notEqual(result.status, 0, result.stdout);
            assert.ok(
                !result.trace.some((item) => ['executable-access', 'spawn', 'scratch-create'].includes(item.event)),
            );
            assert.equal(calls(result, 'dct_connection_start').length, 0);
        }
        const skipped = await invoke(assess.slice(1), { collection: 'valid', assessment: true });
        assert.equal(skipped.status, 0);
        assert.deepEqual(skipped.trace, []);
    });

    test('assessment writes admission before acquisition and qualifies exactly one verified first start and original finally', async () => {
        const result = await invoke(assess, { collection: 'valid', assessment: true });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(calls(result, 'dct_connection_start').length, 1);
        assert.equal(calls(result, 'dct_connection_stop').length, 1);
        assert.equal(calls(result, 'dct_connection_restart').length, 0);
        assert.equal(result.trace.filter((item) => item.event === 'admission-git').length, 4);
        assert.equal(calls(result, 'get_css_styles').length, 0);
        assert.equal(calls(result, 'take_snapshot').length, 0);
        const receipts = controls(result);
        assert.equal(receipts.length, 2);
        const [admission, terminal] = receipts;
        assert.ok(isRecord(admission) && isRecord(terminal));
        assert.equal(admission.result, 'admitted');
        assert.equal(terminal.firstOutcome, 'succeeded');
        assert.equal(terminal.parentBinding, 'bound');
        assert.equal(terminal.fixtureOutcome, 'passed');
        assert.deepEqual(terminal.cleanup, { targetClosed: true, gatewayExited: true, profileDeleted: true });
        const expected = calls(result, 'dct_connection_start')[0]?.detail;
        assert.ok(isRecord(expected) && isRecord(expected.arguments) && isRecord(terminal.selected));
        assert.equal(terminal.selected.requestId, expected.arguments.requestId);
        assert.ok(
            result.trace.findIndex((item) => item.event === 'control-write') <
                result.trace.findIndex((item) => item.event === 'executable-access'),
        );
        assert.equal(result.trace.at(-1)?.event, 'control-write');
        assert.equal(result.summary?.state, 'passed');
        assert.equal(result.recovery?.state, 'not-run');
        const spawned = result.trace.find((item) => item.event === 'spawn')?.detail;
        assert.ok(
            isRecord(spawned) &&
                Array.isArray(spawned.args) &&
                isRecord(spawned.options) &&
                isRecord(spawned.options.env),
        );
        assert.ok(spawned.args.some((arg) => typeof arg === 'string' && arg.includes('firstStartCapture=1')));
        assert.ok(!Object.keys(spawned.options.env).some((key) => key.startsWith('DCT_ASSESSMENT_')));
        assert.ok(!result.trace.some((item) => item.event === 'native-signal'));
    });

    test('assessment output failure is contained, admission prevents launch and terminal never repairs its write', async () => {
        for (const failure of ['admission-partial', 'admission-epipe', 'terminal-partial', 'terminal-epipe']) {
            const result = await invoke(assess, { collection: 'valid', assessment: true, failure });
            assert.notEqual(result.status, 0, failure);
            const admitted = failure.startsWith('admission');
            assert.equal(calls(result, 'dct_connection_start').length, admitted ? 0 : 1);
            assert.equal(calls(result, 'dct_connection_stop').length, admitted ? 0 : 1);
            assert.equal(controls(result).length, 2);
            assert.equal(result.summary?.state, admitted ? 'failed' : 'passed');
            assert.ok(!result.stderr.includes('synthetic pipe'));
        }
    });

    test('assessment failures keep cleanup and actual fixture outcome separate from evidence qualification', async () => {
        for (const failure of [
            'preparation',
            'start',
            'profile-and-cleanup',
            'cleanup',
            'profile-cleanup',
            'gateway-exit',
            'missing-observer-terminal',
            'foreign-selection',
        ]) {
            const result = await invoke(assess, { collection: 'valid', assessment: true, failure });
            assert.notEqual(result.status, 0, failure);
            const launches = failure === 'preparation' ? 0 : 1;
            assert.equal(calls(result, 'dct_connection_start').length, launches);
            assert.equal(calls(result, 'dct_connection_stop').length, failure === 'start' ? 0 : launches);
            assert.equal(result.trace.filter((item) => item.event === 'gateway-exit').length, launches);
            assert.equal(controls(result).length, 2);
            assert.equal(
                result.summary?.state,
                ['missing-observer-terminal', 'foreign-selection'].includes(failure) ? 'passed' : 'failed',
            );
            if (failure === 'profile-and-cleanup') assert.match(result.stderr, /Error: Profile observation failed/);
            if (failure === 'start') {
                const terminal = controls(result)[1];
                const request = calls(result, 'dct_connection_start')[0]?.detail;
                assert.ok(
                    isRecord(terminal) &&
                        isRecord(terminal.selected) &&
                        isRecord(request) &&
                        isRecord(request.arguments),
                );
                assert.equal(terminal.selected.requestId, request.arguments.requestId);
            }
            assert.ok(!result.trace.some((item) => item.event === 'native-signal'));
        }
        const original = await invoke(assess, {
            collection: 'valid',
            assessment: true,
            failure: 'profile-and-cleanup',
            controlFailure: 'terminal-epipe',
        });
        assert.match(original.stderr, /Error: Profile observation failed/);
        assert.doesNotMatch(
            original.stderr,
            /Error: synthetic pipe|Error: First-start assessment evidence unavailable/,
        );
        assert.equal(calls(original, 'dct_connection_stop').length, 1);
        assert.equal(original.trace.filter((item) => item.event === 'gateway-exit').length, 1);
    });

    test('provider termination while normal Close is pending cannot emit terminal or claim cleanup', async () => {
        const result = await invoke(assess, { collection: 'valid', assessment: true, failure: 'normal-close-pending' });
        assert.equal(result.status, 23);
        assert.equal(calls(result, 'dct_connection_start').length, 1);
        assert.equal(calls(result, 'dct_connection_stop').length, 1);
        assert.equal(controls(result).length, 1);
        assert.equal(result.summary?.state, 'running');
        assert.equal(result.trace.at(-1)?.event, 'provider-termination');
        assert.ok(!result.trace.some((item) => ['gateway-exit', 'native-signal'].includes(item.event)));
    });

    test('readahead CLI rejects invalid scope and values before any acquisition', async () => {
        for (const args of [
            ['--readahead-kb', '128'],
            [...study('off').slice(1), '--readahead-kb', '128'],
            [...study('on').slice(1), '--readahead-kb', '256'],
            [...study('on').slice(1), '--readahead-kb', '128', '--readahead-kb', '1024'],
        ]) {
            const result = await invoke(['--allow-gui', ...args], { collection: 'valid' });
            assert.notEqual(result.status, 0);
            assert.deepEqual(result.trace, []);
        }
        const skipped = await invoke([...study('on').slice(1), '--readahead-kb', '1024'], { collection: 'valid' });
        assert.equal(skipped.status, 0);
        assert.deepEqual(skipped.trace, []);
    });

    test('admitted readahead CLI starts once and missing actual resource proof prevents restore after child success', async () => {
        const result = await invoke([...study('on'), '--readahead-kb', '1024'], { collection: 'valid' });
        assert.equal(calls(result, 'dct_connection_start').length, 1, result.stderr);
        assert.equal(calls(result, 'dct_connection_stop').length, 1);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /pending actual exit\/resource proof/);
        assert.deepEqual(
            result.trace.filter((record) => record.event === 'readahead-write').map((record) => record.detail),
            [1024],
        );
    });

    test('readahead CLI admission I/O and write failures retain zero start calls in safe final evidence', async () => {
        for (const failure of ['readahead-io', 'readahead-write-failure']) {
            const result = await invoke([...study('on'), '--readahead-kb', '1024'], { collection: 'valid', failure });
            assert.notEqual(result.status, 0, failure);
            assert.equal(calls(result, 'dct_connection_start').length, 0, failure);
            assert.ok(Array.isArray(result.summary?.readaheadStudy));
            const last = result.summary.readaheadStudy.at(-1);
            assert.ok(isRecord(last));
            assert.equal(last.phase, 'restore');
            assert.equal(last.startCalls, 0);
            assert.equal(last.outcome, failure === 'readahead-io' ? 'unavailable' : 'pending');
        }
    });

    test('readahead CLI complete owned resource proof permits one successful restoration with actual readback', async () => {
        const result = await invoke([...study('on'), '--readahead-kb', '1024'], {
            collection: 'valid',
            failure: 'readahead-success',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(calls(result, 'dct_connection_start').length, 1);
        assert.equal(calls(result, 'dct_connection_stop').length, 1);
        assert.deepEqual(
            result.trace.filter((record) => record.event === 'readahead-write').map((record) => record.detail),
            [1024, 256],
        );
        assert.ok(Array.isArray(result.summary?.readaheadStudy));
        const last = result.summary.readaheadStudy.at(-1);
        assert.ok(isRecord(last));
        assert.equal(last.phase, 'restore');
        assert.equal(last.outcome, 'verified');
        assert.equal(last.readAheadKb, 256);
        assert.equal(last.startCalls, 1);
    });

    test('real Node preload bounds initialization and reconciles late resource cost before beforeExit marker', async () => {
        const { createFixtureArtifacts, readFixtureProgress } = await import('./smoke/fixture-artifacts.ts');
        for (const failure of [
            'preload-late-canonical',
            'preload-late-initialization-read',
            'preload-late-metadata',
            'preload-late-read',
        ]) {
            const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-real-preload-regression-'));
            try {
                const diagnostics = path.join(folder, 'diagnostics');
                const collectionId = await fixtureJobIndex('init', diagnostics);
                assert.ok(collectionId);
                const parent = createFixtureArtifacts(diagnostics, 'official-server', { collectionId });
                assert.equal(parent.snapshot().collectionRejected, false);
                const preload = new URL('./smoke/fixture-preload.ts', import.meta.url);
                preload.searchParams.set('directory', diagnostics);
                preload.searchParams.set('fixture', 'official-server');
                preload.searchParams.set('collectionId', collectionId);
                preload.searchParams.set('readaheadKb', '1024');
                preload.searchParams.set('readaheadExecutable', '/synthetic/chrome');
                const script = `await import(${JSON.stringify(preload.href)}); const { channel } = await import('node:diagnostics_channel'); channel('debugging-cdp-targets.fixture').publish({stage:'readiness',phase:'waiting-cdp',event:'end',outcome:'succeeded',timestampMs:1,durationMs:0});`;
                const child = spawnSync(
                    process.execPath,
                    ['--import', import.meta.url, '--input-type=module', '--eval', script],
                    {
                        encoding: 'utf8',
                        timeout: 5000,
                        env: {
                            ...process.env,
                            NODE_OPTIONS: '',
                            STUDY_TRACE: path.join(folder, 'trace.json'),
                            STUDY_PLATFORM: 'linux',
                            STUDY_FAILURE: failure,
                        },
                    },
                );
                assert.ifError(child.error);
                assert.equal(child.status, 0, child.stderr);
                const progress = readFixtureProgress(diagnostics, 'official-server');
                assert.equal(progress.invalidEvents, 0);
                const bounded = progress.readaheadStudy.find(
                    (record) => record.phase === (failure === 'preload-late-read' ? 'terminal' : 'initialization'),
                );
                assert.equal(bounded?.outcome, 'unavailable', failure);
                assert.equal(bounded?.cost, 'pending', failure);
                assert.equal(bounded?.bytes, undefined, failure);
                const marker = progress.readaheadStudy.at(-1);
                assert.equal(marker?.phase, 'observer');
                assert.equal(marker?.outcome, 'verified');
                assert.equal(marker?.cost, 'complete');
                assert.equal(
                    marker?.bytes,
                    failure === 'preload-late-read' ? 48 : failure === 'preload-late-initialization-read' ? 4 : 0,
                );
                assert.ok((marker?.metadataOps ?? 0) > 0);
            } finally {
                await rm(folder, { recursive: true, force: true });
            }
        }
    });

    test('study CLI keeps GUI authorization first even for hostile parameters', async () => {
        const result = await invoke(['--startup-study', '--chrome-file-logging', 'bad', '--unknown'], {
            collection: 'valid',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /SKIP: GUI execution requires explicit --allow-gui/);
        assert.deepEqual(result.trace, []);
        assert.equal(result.summary?.state, 'not-run');
        assert.equal(result.recovery?.state, 'not-run');
    });

    test('study CLI rejects missing, invalid and duplicated parameters before acquisition', async () => {
        for (const args of [
            ['--startup-study'],
            ['--chrome-file-logging', 'on'],
            ['--startup-study', '--chrome-file-logging'],
            ['--startup-study', '--chrome-file-logging', 'ON'],
            ['--startup-study', '--chrome-file-logging', 'off', '--startup-study'],
            ['--startup-study', '--chrome-file-logging', 'off', '--chrome-file-logging', 'on'],
            ['--startup-study', '--chrome-file-logging=off'],
            ['--startup-study', '--chrome-file-logging', 'off', '--unknown'],
        ]) {
            const result = await invoke(['--allow-gui', ...args], { collection: 'valid' });
            assert.notEqual(result.status, 0, JSON.stringify(args));
            assert.deepEqual(result.trace, [], JSON.stringify(args));
        }
    });

    test('study CLI requires Linux and a current accepted collection before acquisition', async () => {
        for (const options of [
            {},
            { collection: 'refused' as const },
            { collection: 'valid' as const, platform: 'darwin' },
            { collection: 'valid' as const, platform: 'win32' },
        ]) {
            const result = await invoke(study('off'), options);
            assert.notEqual(result.status, 0, result.stdout);
            assert.match(result.stderr, /study.*(?:Linux|collection)/i);
            assert.deepEqual(result.trace, []);
        }
    });

    test('on/off studies preserve real first-start verification and cleanup with only logging flags changed', async () => {
        const results: Invocation[] = [];
        for (const arm of ['on', 'off']) {
            const result = await invoke(study(arm), { collection: 'valid' });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(calls(result, 'dct_connection_start').length, 1);
            assert.equal(calls(result, 'dct_connection_stop').length, 1);
            assert.equal(calls(result, 'get_css_styles').length, 0);
            assert.equal(calls(result, 'list_extensions').length, 0);
            assert.equal(calls(result, 'take_snapshot').length, 0);
            assert.deepEqual(
                result.trace
                    .filter((item) => ['native-proc-open', 'endpoint', 'profile-probe'].includes(item.event))
                    .map((item) => (item.event === 'native-proc-open' ? item.detail : item.event)),
                ['/proc/4100/stat', '/proc/4100/stat', '/proc/stat', 'endpoint', '/proc/4100/stat', 'profile-probe'],
            );
            const native = result.trace.filter((item) => item.event === 'native-command');
            assert.deepEqual(
                native.map((item) => isRecord(item.detail) && item.detail.executable),
                ['ps', 'getconf', 'lsof', 'getconf', 'getconf'],
            );
            assert.ok(
                native.every(
                    (item) =>
                        isRecord(item.detail) && isRecord(item.detail.options) && item.detail.options.shell === false,
                ),
            );
            assert.deepEqual(
                result.trace.filter((item) => item.event === 'native-signal'),
                [],
            );
            assert.equal(result.trace.filter((item) => item.event === 'display-preflight').length, 1);
            assert.equal(result.trace.filter((item) => item.event === 'gateway-exit').length, 1);
            assert.equal(result.trace.filter((item) => item.event === 'scratch-remove').length, 1);
            assert.match(result.stdout, /single-launch study/i);
            assert.match(result.stdout, /"result":"passed"/);
            assert.match(result.stdout, new RegExp(`"chromeFileLogging":"${arm}"`));
            assert.match(result.stdout, new RegExp(`"expectedLogAbsence":${arm === 'off'}`));
            assert.doesNotMatch(result.stdout, /Official tools, CSS styles and extensions.*passed/);
            assert.equal(result.summary?.state, 'passed');
            assert.equal(result.recovery?.state, 'not-run');
            assert.ok(Array.isArray(result.summary?.browserStartup));
            assert.ok(
                result.summary.browserStartup.some(
                    (record: unknown) =>
                        isRecord(record) &&
                        record.phase === 'log' &&
                        record.launch === 1 &&
                        record.absent === true &&
                        record.readFailed === false,
                ),
            );
            const spawn = result.trace.find((item) => item.event === 'spawn')?.detail;
            assert.ok(isRecord(spawn) && Array.isArray(spawn.args) && spawn.args[0] === '--import');
            assert.match(String(spawn.args[1]), /fixture-preload.*collectionId=/);
            const lifecycle = result.trace.filter((item) => item.event === 'request').map((item) => item.detail);
            assert.deepEqual(
                lifecycle.map((detail) => isRecord(detail) && (detail.name ?? detail.method)),
                [
                    'initialize',
                    'tools/list',
                    'dct_connection_status',
                    'dct_connection_status',
                    'list_pages',
                    'dct_connection_start',
                    'dct_operation_wait',
                    'dct_connection_status',
                    'list_pages',
                    'select_page',
                    'dct_connection_stop',
                    'dct_operation_wait',
                ],
            );
            const stopped = calls(result, 'dct_connection_stop')[0]?.detail;
            assert.ok(isRecord(stopped) && isRecord(stopped.arguments));
            assert.equal(stopped.arguments.disposition, 'Close');
            assert.equal(stopped.arguments.entryId, '11111111-1111-4111-8111-111111111111');
            assert.equal(stopped.arguments.connectionId, '22222222-2222-4222-8222-000000000001');
            assert.equal(stopped.arguments.sessionId, '33333333-3333-4333-8333-000000000001');
            const exited = result.trace.findIndex((item) => item.event === 'gateway-exit');
            const deletedProfile = result.trace.findIndex(
                (item, index) =>
                    index > exited &&
                    item.event === 'scratch-inspect' &&
                    item.detail === '/synthetic/smoke/profile-one',
            );
            assert.ok(deletedProfile > exited, 'Finally must verify lease deletion after gateway exit.');
            assert.ok(result.stdout.indexOf('"startupStudyResult"') > result.stdout.indexOf('"phase":"cleanup"'));
            results.push(result);
        }
        const launchArgs = results.map((result) => {
            const request = calls(result, 'dct_connection_start')[0]?.detail;
            assert.ok(isRecord(request) && isRecord(request.arguments) && isRecord(request.arguments.launch));
            assert.ok(Array.isArray(request.arguments.launch.args));
            return request.arguments.launch.args;
        });
        const on = launchArgs[0];
        const off = launchArgs[1];
        assert.ok(on && off);
        assert.deepEqual(
            on.filter(
                (arg) => typeof arg === 'string' && (arg === '--enable-logging' || arg.startsWith('--log-file=')),
            ),
            ['--enable-logging', '--log-file=/synthetic/startup/launch-1.log'],
        );
        assert.deepEqual(
            on.filter((arg) => arg !== '--enable-logging' && !String(arg).startsWith('--log-file=')),
            off,
        );
    });

    test('study failures keep the original primary error and attempt the same final cleanup', async () => {
        for (const failure of [
            'profile',
            'version',
            'profile-and-cleanup',
            'cleanup',
            'start',
            'gateway-exit',
            'profile-cleanup',
        ]) {
            const result = await invoke(study('off'), { collection: 'valid', failure });
            assert.notEqual(result.status, 0, failure);
            assert.equal(calls(result, 'dct_connection_start').length, 1);
            assert.equal(calls(result, 'dct_connection_stop').length, failure === 'start' ? 0 : 1);
            assert.equal(result.trace.filter((item) => item.event === 'gateway-exit').length, 1);
            assert.equal(result.summary?.state, 'failed');
            assert.match(result.stdout, /"result":"failed"/);
            assert.equal(result.trace.filter((item) => item.event === 'scratch-remove').length, 0);
            assert.doesNotMatch(result.stdout, /Official tools, CSS styles and extensions.*passed/);
            if (failure === 'profile-and-cleanup') {
                assert.ok(isRecord(result.summary?.primary) && isRecord(result.summary.primary.error));
                assert.equal(result.summary.primary.stage, 'acceptance');
                assert.match(result.stderr, /Error: Profile observation failed/);
                assert.ok(Array.isArray(result.summary.secondary) && result.summary.secondary.length > 0);
            }
        }
    });

    test('Linux study uses actual raw identity and listener validators before profile acceptance', async () => {
        for (const [failure, message] of [
            ['native-q-change', /raw identity bracket changed/],
            ['native-listener-foreign', /listener owner does not belong/],
        ] as const) {
            const result = await invoke(study('off'), { collection: 'valid', failure });
            assert.notEqual(result.status, 0, result.stderr);
            assert.match(result.stderr, message);
            assert.equal(calls(result, 'dct_connection_start').length, 1);
            assert.equal(calls(result, 'dct_connection_stop').length, 1);
            assert.equal(result.trace.filter((item) => item.event === 'profile-probe').length, 0);
            assert.equal(result.trace.filter((item) => item.event === 'endpoint').length, 1);
            assert.deepEqual(
                result.trace.filter((item) => item.event === 'native-signal'),
                [],
            );
            assert.equal(result.summary?.state, 'failed');
        }
    });

    test('failed-first-start capture is passed only to the current ordinary Linux fixture child', async () => {
        for (const scenario of [
            { options: { collection: 'valid' as const, failedFirstStartCapture: true }, armed: true },
            { options: { collection: 'valid' as const }, armed: false },
            {
                options: { collection: 'valid' as const, failedFirstStartCapture: true, platform: 'darwin' },
                armed: false,
            },
            { options: { failedFirstStartCapture: true }, armed: false },
            { options: { collection: 'refused' as const, failedFirstStartCapture: true }, armed: false },
            { options: { collection: 'valid' as const, failedFirstStartCapture: true }, study: true, armed: false },
        ]) {
            const result = await invoke(scenario.study ? study('on') : ['--allow-gui'], scenario.options);
            assert.equal(result.status, 0, result.stderr);
            const gatewaySpawn = result.trace.find((item) => item.event === 'spawn')?.detail;
            assert.ok(isRecord(gatewaySpawn) && Array.isArray(gatewaySpawn.args));
            const preloadArgument = gatewaySpawn.args.find(
                (value: unknown) => typeof value === 'string' && value.includes('fixture-preload.ts?'),
            );
            const armed =
                typeof preloadArgument === 'string'
                    ? new URL(preloadArgument).searchParams.get('firstStartCapture') === '1'
                    : false;
            assert.equal(armed, scenario.armed);
            assert.equal(calls(result, 'dct_connection_start').length, scenario.study ? 1 : 2);
            assert.equal(calls(result, 'dct_connection_stop').length, scenario.study ? 1 : 2);
        }
    });

    test('normal default and collected smoke retain complete acceptance without study output', async () => {
        for (const collection of [undefined, 'valid'] as const) {
            const result = await invoke(['--allow-gui'], collection ? { collection } : {});
            assert.equal(result.status, 0, result.stderr);
            assert.equal(calls(result, 'dct_connection_start').length, 2);
            assert.equal(calls(result, 'dct_connection_stop').length, 2);
            assert.equal(calls(result, 'get_css_styles').length, 1);
            assert.equal(calls(result, 'list_extensions').length, 1);
            assert.match(result.stdout, /Official tools, CSS styles and extensions.*passed/);
            assert.doesNotMatch(result.stdout, /single-launch study|chromeFileLogging|expectedLogAbsence/i);
        }
    });
}
