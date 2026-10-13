import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/errors.ts';
import { retainNativeResourceFixture, withNativeResourceCleanup } from './fixtures/native-resource-cleanup.ts';
import {
    createNativeResourceLog,
    NativeFixtureFailure,
    type NativeResourceVariant,
    type WitnessDiagnostic,
    type WitnessRole,
} from './fixtures/native-resource-log.ts';
import { retainExitWitness, retainWitnessFromPidText } from './fixtures/native-resource-witness.ts';

function logger(variant: NativeResourceVariant = 'group-normal') {
    const lines: string[] = [];
    const log = createNativeResourceLog(variant, { sink: (line) => lines.push(line) });
    const records = () =>
        lines.map((line) => {
            const record: unknown = JSON.parse(line);
            assert.ok(isRecord(record));
            return record;
        });
    const last = () => {
        const record = records().at(-1);
        assert.ok(record);
        return record;
    };
    return { log, lines, records, last };
}

class WitnessChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly pid: number | undefined;
    constructor(pid: number | undefined = undefined) {
        super();
        this.pid = pid;
    }
}

function witness(role: WitnessRole = 'root') {
    const child = new WitnessChild();
    const capture = logger();
    const retained = retainExitWitness(123, role, 'initial-arming', capture.log, () => child);
    return { child, retained, ...capture };
}

test('native lifecycle emits launch and initial-arming BEGIN before their actions', async () => {
    const { log, records, last } = logger();
    await log.step('fixture', undefined, async () => {
        await log.step('launch', undefined, () => {
            assert.equal(last().event, 'BEGIN');
            assert.equal(last().stage, 'launch');
        });
        const failure = new Error('private initial arming');
        await assert.rejects(
            log.step('initial-arming', undefined, () => {
                assert.equal(last().stage, 'initial-arming');
                assert.equal(last().event, 'BEGIN');
                throw failure;
            }),
            (error: unknown) => error === failure,
        );
        assert.equal(last().event, 'FAILURE');
    });
    log.finish();
    assert.equal(new Set(records().map((record) => record.fixtureId)).size, 1);
    assert.ok(
        records().every(
            (record, index) =>
                record.sequence === index + 1 && typeof record.relativeMs === 'number' && record.relativeMs >= 0,
        ),
    );
    assert.ok(!records().some((record) => record.stage === 'cleanup'));
});
test('pending native waits publish BEGIN before settlement and preserve rejection identity', async () => {
    const { log, records, last } = logger();
    await log.step('launch', undefined, () => {});
    let rejectWait = (_error: Error) => {};
    const original = new Promise<void>((_resolve, reject) => {
        rejectWait = reject;
    });
    assert.equal(log.observe('resource-wait', undefined, original), original);
    assert.equal(last().stage, 'resource-wait');
    assert.equal(last().event, 'BEGIN');
    const primary = new Error('private pending failure');
    rejectWait(primary);
    await assert.rejects(original, (error: unknown) => error === primary);
    await Promise.resolve();
    assert.equal(last().event, 'FAILURE');
    assert.ok(!JSON.stringify(records()).includes(primary.message));
});

test('native witness phases and safe failures are visible before close without private output', async () => {
    const { child, retained, records, last } = witness('middle');
    child.stdout.write(`${JSON.stringify({ event: 'phase', role: 'middle', pid: 123, phase: 'inspect' })}\n`);
    assert.equal(last().phase, 'inspect');
    child.stderr.write('SECRET C:\\private\\cookie token=hidden');
    child.stdout.write(
        `${JSON.stringify({ event: 'failed', role: 'middle', pid: 123, phase: 'inspect', errorKind: 'native', win32Code: 5, hresult: -2147467259 })}\n`,
    );
    child.emit('close', 7, null);
    await assert.rejects(retained.armed);
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        const evidence = error.diagnostic;
        assert.equal(evidence.role, 'middle');
        assert.equal(evidence.phase, 'inspect');
        assert.equal(evidence.armed, false);
        assert.equal(evidence.closeCode, 7);
        assert.equal(evidence.win32Code, 5);
        assert.equal(evidence.hresult, -2147467259);
        return true;
    });
    assert.equal(last().event, 'CLOSE');
    assert.ok(!JSON.stringify(records()).includes('SECRET'));
    assert.ok(!JSON.stringify(records()).includes('private'));
});

test('native witness success uses matching full identity and drained ordinary exit receipt', async () => {
    const { child, retained, log, records, last } = witness();
    const armed = `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00.000Z' })}\n`;
    child.stdout.write(armed.slice(0, 20));
    child.stdout.write(armed.slice(20));
    await retained.armed;
    assert.equal(last().executableVerified, true);
    assert.ok(!JSON.stringify(records()).includes(process.execPath));
    child.emit('exit', 0, null);
    child.stdout.write(`${JSON.stringify({ event: 'exited', role: 'root', pid: 123, exitCode: 0 })}\n`);
    child.emit('close', 0, null);
    await retained.exited;
    log.finish();
    assert.equal(last().event, 'SUMMARY');
    assert.equal(log.snapshot().incomplete, false);
});

test('finish with a closed root and pending middle witness stays incomplete after late callbacks', async () => {
    const { log, records, last } = logger('group-abandoned-body-failure');
    const rootChild = new WitnessChild(501);
    const middleChild = new WitnessChild(502);
    const root = retainExitWitness(123, 'root', 'initial-arming', log, () => rootChild);
    const middle = retainExitWitness(124, 'middle', 'initial-arming', log, () => middleChild);
    rootChild.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    middleChild.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'middle', pid: 124, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await Promise.all([root.armed, middle.armed]);
    rootChild.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":0}\n');
    rootChild.emit('close', 0, null);
    await root.exited;
    const primary = new Error('injected primary');
    const cleanup = new Error('late PID cleanup failure');
    await assert.rejects(
        withNativeResourceCleanup(
            log,
            () => {
                throw primary;
            },
            () => {
                throw cleanup;
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [primary, cleanup]);
            assert.equal(error.cause, primary);
            return true;
        },
    );
    log.finish();
    const summary = last();
    assert.equal(summary.event, 'SUMMARY');
    assert.ok(isRecord(summary.limits));
    assert.equal(summary.limits.incomplete, true);
    middleChild.stdout.write('{"event":"phase","role":"middle","pid":124,"phase":"wait"}\n');
    middleChild.stdout.write('{"event":"exited","role":"middle","pid":124,"exitCode":0}\n');
    middleChild.emit('close', 0, null);
    await middle.exited;
    assert.equal(log.snapshot().incomplete, true);
    const lateRecords = records().filter((record) => Number(record.sequence) > Number(summary.sequence));
    assert.ok(lateRecords.some((record) => record.event === 'PHASE' && record.role === 'middle'));
    assert.ok(lateRecords.some((record) => record.event === 'CLOSE' && record.role === 'middle'));
    assert.ok(lateRecords.every((record) => isRecord(record.limits) && record.limits.incomplete === true));
});

test('finish with only an armed witness pending cannot publish complete evidence', async () => {
    const { child, retained, log, last } = witness('middle');
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'middle', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    log.finish();
    const summary = last();
    assert.ok(isRecord(summary.limits));
    assert.equal(summary.limits.incomplete, true);
    child.stdout.write('{"event":"exited","role":"middle","pid":123,"exitCode":0}\n');
    child.emit('close', 0, null);
    await retained.exited;
    assert.equal(log.snapshot().incomplete, true);
});

test('rejected witness observation before helper close stays incomplete and preserves its error', async () => {
    const { child, retained, log, records, last } = witness('middle');
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'middle', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    const armed = retained.armed;
    const exited = retained.exited;
    await armed;
    child.stderr.emit('error', new Error('private pipe failure'));
    let failure: NativeFixtureFailure | undefined;
    await assert.rejects(exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.closeCode, null);
        failure = error;
        return true;
    });
    assert.ok(!records().some((record) => record.event === 'CLOSE'));
    log.finish();
    assert.ok(isRecord(last().limits));
    assert.equal(log.snapshot().incomplete, true);
    child.emit('close', 1, null);
    await assert.rejects(exited, (error: unknown) => error === failure);
    assert.equal(retained.armed, armed);
    assert.equal(retained.exited, exited);
    assert.equal(log.snapshot().incomplete, true);
    const closed = last();
    assert.equal(closed.event, 'CLOSE');
    assert.ok(isRecord(closed.limits) && closed.limits.incomplete === true);
});

for (const stage of ['fixture', 'cleanup'] as const) {
    test(`unhandled ${stage} failure before witness acquisition leaves incomplete evidence`, async () => {
        const { log, last } = logger();
        const failure = new Error('private early failure');
        await assert.rejects(
            log.step(stage, undefined, () => {
                throw failure;
            }),
            (error: unknown) => error === failure,
        );
        log.finish();
        assert.equal(last().event, 'SUMMARY');
        assert.equal(log.snapshot().incomplete, true);
    });
}

test('expected body and resource wait failures with complete cleanup remain complete', async () => {
    const { log } = logger('group-body-failure');
    const primary = new Error('expected primary');
    const resource = new Error('expected resource wait');
    await log.step('fixture', undefined, async () => {
        await assert.rejects(
            log.observe('resource-wait', undefined, Promise.reject(resource)),
            (error: unknown) => error === resource,
        );
        await assert.rejects(
            withNativeResourceCleanup(
                log,
                () => {
                    throw primary;
                },
                () => {},
            ),
            (error: unknown) => error === primary,
        );
    });
    log.finish();
    assert.equal(log.snapshot().incomplete, false);
});

test('post-summary callbacks publish bounded sticky incomplete evidence', async () => {
    const { child, retained, log, records, lines } = witness();
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    child.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":0}\n');
    child.emit('close', 0, null);
    await retained.exited;
    log.finish();
    const summary = records().at(-1);
    assert.ok(summary && isRecord(summary.limits));
    assert.equal(summary.limits.incomplete, false);
    child.stdout.write('{"event":"phase","role":"root","pid":123,"phase":"exit"}\n');
    child.stderr.emit('error', new Error('late private pipe failure'));
    assert.equal(log.snapshot().incomplete, true);
    const lateRecords = records().filter((record) => Number(record.sequence) > Number(summary.sequence));
    assert.ok(lateRecords.length > 0);
    assert.ok(lateRecords.every((record) => isRecord(record.limits) && record.limits.incomplete === true));
    assert.equal(lateRecords.filter((record) => record.event === 'LIMITATION').length, 1);
    assert.ok(lines.length <= 128);
    assert.ok(lines.every((line) => Buffer.byteLength(line) <= 4096));
    assert.ok(lines.reduce((total, line) => total + Buffer.byteLength(line), 0) <= 131072);
});

for (const kind of ['diagnostics-only', 'foreign-identity', 'truncated', 'signal', 'spawn'] as const) {
    test(`native witness fails closed and settles both waiters: ${kind}`, async () => {
        const { child, retained, records } = witness();
        if (kind === 'diagnostics-only')
            child.stdout.write('{"event":"phase","role":"root","pid":123,"phase":"wait"}\n');
        if (kind === 'foreign-identity')
            child.stdout.write(
                `${JSON.stringify({ event: 'armed', role: 'root', pid: 124, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
            );
        if (kind === 'truncated') {
            child.stdout.write('x'.repeat(300_000));
            child.stderr.write('SECRET'.repeat(100_000));
            child.stdout.write('\n');
        }
        if (kind === 'spawn') child.emit('error', new Error('SECRET C:\\private spawn'));
        child.emit('close', kind === 'signal' ? null : 0, kind === 'signal' ? 'SIGTERM' : null);
        await assert.rejects(retained.armed);
        await assert.rejects(retained.exited, (error: unknown) => {
            assert.ok(error instanceof NativeFixtureFailure);
            const evidence = error.diagnostic;
            if (kind === 'truncated') {
                assert.equal(evidence.stdout.truncated, true);
                assert.ok(evidence.stdout.retainedBytes <= 262144);
                assert.equal(evidence.stderr.bytes, 600000);
            }
            if (kind === 'signal') {
                assert.equal(evidence.closeCode, null);
                assert.equal(evidence.signal, 'SIGTERM');
            }
            return true;
        });
        assert.ok(!JSON.stringify(records()).includes('SECRET'));
    });
}

test('PID preflight classifies invalid text without spawning and passes exact valid PID', async () => {
    for (const [text, state] of [
        ['', 'empty'],
        ['12x', 'malformed'],
        ['0', 'out-of-range'],
        ['2147483648', 'out-of-range'],
        [undefined, 'missing'],
    ] as const) {
        let spawns = 0;
        const { log } = logger();
        await assert.rejects(
            retainWitnessFromPidText(text, 'late', 'late-arming', log, () => {
                spawns++;
                return new WitnessChild();
            }),
            (error: unknown) => {
                assert.ok(error instanceof NativeFixtureFailure);
                assert.equal(error.diagnostic.pidState, state);
                return true;
            },
        );
        assert.equal(spawns, 0);
    }
    const child = new WitnessChild();
    const { log } = logger();
    const retained = await retainWitnessFromPidText(
        ' 00123\n',
        'late',
        'late-arming',
        log,
        (executable, args, options) => {
            assert.equal(executable, 'powershell.exe');
            assert.deepEqual(args.slice(-4), ['-OwnedPid', '123', '-Role', 'late']);
            assert.deepEqual(options, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            return child;
        },
    );
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'late', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    child.stdout.write('{"event":"exited","role":"late","pid":123,"exitCode":0}\n');
    child.emit('close', 0, null);
    await retained.exited;
});

test('bounded logging cannot block cleanup or leak arbitrary oversized payloads', async () => {
    const { log, lines } = logger();
    for (let index = 0; index < 200; index++)
        log.event(
            'PHASE',
            'initial-arming',
            'root',
            Object.assign({ phase: 'compile' as const }, { secret: 'SECRET'.repeat(10000) }),
        );
    log.finish();
    assert.ok(lines.length <= 128);
    assert.ok(lines.every((line) => Buffer.byteLength(line) <= 4096));
    assert.ok(lines.reduce((total, line) => total + Buffer.byteLength(line), 0) <= 131072);
    assert.equal(log.snapshot().truncated, true);
    assert.ok(log.snapshot().droppedEvents > 0);
    assert.ok(!lines.join('').includes('SECRET'));
    for (const sink of [
        () => {
            throw new Error('SECRET sink');
        },
        (_line: string, failed: (error?: Error) => void) => failed(new Error('SECRET sink')),
        () => new Promise<void>(() => {}),
        () => Promise.reject(new Error('SECRET rejected sink')),
    ]) {
        const broken = createNativeResourceLog('group-normal', { sink });
        let executed = 0;
        await broken.step('cleanup', undefined, () => {
            executed++;
        });
        broken.finish();
        assert.equal(executed, 1);
    }
});

test('byte budget exhaustion preserves room for limitation and terminal accounting', () => {
    const { log, lines, records } = logger('group-abandoned-body-failure');
    const diagnostic: WitnessDiagnostic = {
        role: 'middle',
        context: 'initial-arming',
        phase: 'inspect',
        phaseKnown: true,
        spawned: true,
        pidState: 'valid',
        ownedPid: 2147483647,
        witnessPid: null,
        armed: true,
        errorKind: 'native',
        win32Code: -2147483648,
        hresult: -2147483648,
        closeCode: 4294967295,
        applicationExitCode: null,
        signal: 'SIGTERM',
        stdout: { bytes: Number.MAX_SAFE_INTEGER, retainedBytes: 262144, truncated: true, parsing: 'invalid' },
        stderr: { bytes: Number.MAX_SAFE_INTEGER, retainedBytes: 0, truncated: true, parsing: 'not-parsed' },
        armedReceipt: 'accepted',
        exitReceipt: 'rejected',
        failedReceipt: 'accepted',
    };
    for (let index = 0; index < 200; index++) {
        log.event('FAILURE', 'initial-arming', 'middle', {
            diagnostic,
            phase: 'inspect',
            phaseKnown: true,
            ownedPid: 2147483647,
            startedAtUtc: '2026-10-13T00:00:00.000Z',
            executableVerified: true,
            applicationExitCode: 4294967295,
            closeCode: 4294967295,
            signal: 'SIGTERM',
            rootExitSource: 'retained-witness',
        });
    }
    log.finish();
    assert.ok(lines.length < 128, 'Byte limit must take effect before the event limit for these large safe records.');
    assert.ok(lines.every((line) => Buffer.byteLength(line) <= 4096));
    const bytes = lines.reduce((total, line) => total + Buffer.byteLength(line), 0);
    assert.ok(bytes <= 131072);
    assert.equal(log.snapshot().emittedBytes, bytes);
    assert.equal(records().filter((record) => record.event === 'LIMITATION').length, 1);
    assert.equal(records().at(-1)?.event, 'SUMMARY');
    assert.equal(log.snapshot().incomplete, true);
});

test('body and cleanup errors remain separate while clean cleanup preserves primary identity', async () => {
    const preserve = withNativeResourceCleanup;
    const primary = new Error('primary');
    const cleanup = new Error('cleanup');
    const { log, records } = logger();
    await assert.rejects(
        preserve(
            log,
            () => {
                throw primary;
            },
            () => {},
        ),
        (error: unknown) => error === primary,
    );
    await assert.rejects(
        preserve(
            log,
            () => {},
            () => {
                throw cleanup;
            },
        ),
        (error: unknown) => error === cleanup,
    );
    await assert.rejects(
        preserve(
            log,
            () => {
                throw primary;
            },
            () => {
                throw cleanup;
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [primary, cleanup]);
            assert.equal(error.cause, primary);
            return true;
        },
    );
    assert.ok(records().some((record) => record.stage === 'body' && record.event === 'FAILURE'));
    assert.ok(records().some((record) => record.stage === 'cleanup' && record.event === 'FAILURE'));
});

test('an undefined primary remains an own aggregate cause with ordered cleanup evidence', async () => {
    const { log } = logger();
    const cleanup = new Error('cleanup');
    await assert.rejects(
        withNativeResourceCleanup(
            log,
            () => {
                throw undefined;
            },
            () => {
                throw cleanup;
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [undefined, cleanup]);
            assert.equal(Object.hasOwn(error, 'cause'), true);
            assert.equal(error.cause, undefined);
            return true;
        },
    );
});

test('unknown failed errorKind cannot escape data callbacks by string coercion', async () => {
    const { child, retained, lines } = witness();
    const receipt =
        '{"event":"failed","role":"root","pid":123,"phase":"inspect","errorKind":{"toString":null,"private":"SECRET"},"win32Code":null,"hresult":null}\n';
    assert.doesNotThrow(() => child.stdout.write(receipt));
    child.emit('close', 1, null);
    for (const pending of [retained.armed, retained.exited])
        await assert.rejects(pending, (error: unknown) => {
            assert.ok(error instanceof NativeFixtureFailure);
            assert.equal(error.diagnostic.errorKind, 'protocol');
            assert.equal(error.diagnostic.failedReceipt, 'rejected');
            return true;
        });
    assert.ok(!lines.join('').includes('SECRET'));
    assert.ok(!lines.join('').includes('toString'));
});

test('a matching terminal disposal failure preserves prior ordinary application exit evidence', async () => {
    const { child, retained, lines } = witness();
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    child.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":0}\n');
    child.stdout.write(
        '{"event":"failed","role":"root","pid":123,"phase":"exit","errorKind":"native","win32Code":6,"hresult":-2147467259}\n',
    );
    child.emit('close', 1, null);
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.applicationExitCode, 0);
        assert.equal(error.diagnostic.closeCode, 1);
        assert.equal(error.diagnostic.armedReceipt, 'accepted');
        assert.equal(error.diagnostic.exitReceipt, 'accepted');
        assert.equal(error.diagnostic.failedReceipt, 'accepted');
        assert.equal(error.diagnostic.phase, 'exit');
        assert.equal(error.diagnostic.win32Code, 6);
        assert.equal(error.diagnostic.hresult, -2147467259);
        return true;
    });
    assert.ok(!lines.join('').includes(process.execPath));
});

test('a validated terminal failed receipt cannot become success when the witness closes zero', async () => {
    const { child, retained } = witness();
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    child.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":0}\n');
    child.stdout.write(
        '{"event":"failed","role":"root","pid":123,"phase":"exit","errorKind":"unexpected","win32Code":null,"hresult":null}\n',
    );
    child.emit('close', 0, null);
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.applicationExitCode, 0);
        assert.equal(error.diagnostic.closeCode, 0);
        assert.equal(error.diagnostic.failedReceipt, 'accepted');
        return true;
    });
});

for (const receipt of [
    { event: 'phase', role: 'root', pid: 123, phase: 'exit' },
    { event: 'exited', role: 'root', pid: 123, exitCode: 0 },
    {
        event: 'failed',
        role: 'middle',
        pid: 123,
        phase: 'exit',
        errorKind: 'native',
        win32Code: 6,
        hresult: -2147467259,
    },
    { event: 'failed', role: 'root', pid: 123, phase: 'wait', errorKind: 'native', win32Code: 6, hresult: -2147467259 },
    { event: 'failed', role: 'root', pid: 123, phase: 'exit', errorKind: 'native', win32Code: 'SECRET', hresult: null },
]) {
    test(`only a matching validated terminal failure may follow actual exit: ${receipt.event}/${receipt.role}/${receipt.phase ?? 'receipt'}`, async () => {
        const { child, retained } = witness();
        child.stdout.write(
            `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
        );
        await retained.armed;
        child.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":0}\n');
        child.stdout.write(`${JSON.stringify(receipt)}\n`);
        child.emit('close', 0, null);
        await assert.rejects(retained.exited, (error: unknown) => {
            assert.ok(error instanceof NativeFixtureFailure);
            assert.equal(error.diagnostic.errorKind, 'protocol');
            assert.equal(error.diagnostic.applicationExitCode, 0);
            return true;
        });
    });
}

for (const [pid, expected] of [
    [777, 777],
    [undefined, null],
    [0, null],
    [-1, null],
    [1.5, null],
    [2147483648, null],
] as const) {
    test(`witness helper PID is safe association metadata before process output: ${pid ?? 'missing'}`, async () => {
        const child = new WitnessChild(pid);
        const { log, last } = logger();
        const retained = retainExitWitness(123, 'root', 'initial-arming', log, () => child);
        assert.equal(last().event, 'SPAWN');
        assert.equal(last().ownedPid, 123);
        assert.equal(last().witnessPid, expected);
        assert.equal(last().spawned, expected !== null);
        child.stdout.write(
            `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
        );
        await retained.armed;
        child.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":0}\n');
        child.emit('close', 0, null);
        await retained.exited;
        const evidence = last().diagnostic;
        assert.ok(isRecord(evidence));
        assert.equal(evidence.witnessPid, expected);
        assert.equal(evidence.spawned, expected !== null);
        assert.equal(evidence.armed, true);
    });
}

test('an unspawned witness has no helper PID and keeps the controlled spawn failure', async () => {
    const { log } = logger();
    const retained = retainExitWitness(123, 'root', 'initial-arming', log, () => {
        throw new Error('SECRET spawn');
    });
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.witnessPid, null);
        assert.equal(error.diagnostic.spawned, false);
        assert.equal(error.diagnostic.errorKind, 'spawn');
        return true;
    });
});

test('a returned child object without PID is not OS spawn evidence when its error arrives later', async () => {
    const child = new WitnessChild();
    const { log, last } = logger();
    const retained = retainExitWitness(123, 'root', 'initial-arming', log, () => child);
    child.emit('error', new Error('SECRET asynchronous spawn failure'));
    for (const pending of [retained.armed, retained.exited])
        await assert.rejects(pending, (error: unknown) => {
            assert.ok(error instanceof NativeFixtureFailure);
            assert.equal(error.diagnostic.spawned, false);
            assert.equal(error.diagnostic.witnessPid, null);
            assert.equal(error.diagnostic.errorKind, 'spawn');
            return true;
        });
    child.emit('close', null, null);
    const diagnostic = last().diagnostic;
    assert.ok(isRecord(diagnostic));
    assert.equal(diagnostic.spawned, false);
});

test('safe identity normalizes accepted date text and nested diagnostic projection excludes extras', async () => {
    const { log, lines, last } = logger();
    log.event('IDENTITY', 'initial-arming', 'root', { startedAtUtc: 'Tue, 13 Oct 2026 00:00:00 GMT (SECRET)' });
    assert.equal(last().startedAtUtc, '2026-10-13T00:00:00.000Z');
    const { child, retained } = witness();
    child.emit('close', 1, null);
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        const diagnostic = Object.assign({}, error.diagnostic, { secret: 'SECRET'.repeat(3000) });
        log.event('FAILURE', 'initial-arming', 'root', { diagnostic });
        return true;
    });
    assert.ok(!lines.join('').includes('SECRET'));
});

test('armed native wait failures retain target identity status and separate witness close facts', async () => {
    const { child, retained, last } = witness('late');
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'late', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    child.stdout.write('{"event":"phase","role":"late","pid":123,"phase":"wait"}\n');
    child.stdout.write(
        '{"event":"failed","role":"late","pid":123,"phase":"wait","errorKind":"native","win32Code":6,"hresult":-2147467259}\n',
    );
    assert.equal(last().event, 'FAILURE');
    child.emit('close', 4294967295, null);
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.armed, true);
        assert.equal(error.diagnostic.phase, 'wait');
        assert.equal(error.diagnostic.closeCode, 4294967295);
        assert.equal(error.diagnostic.exitReceipt, 'absent');
        return true;
    });
});

test('a nonzero actual application receipt remains failed despite witness code zero', async () => {
    const { child, retained } = witness();
    child.stdout.write(
        `${JSON.stringify({ event: 'armed', role: 'root', pid: 123, executablePath: process.execPath, startedAtUtc: '2026-10-13T00:00:00Z' })}\n`,
    );
    await retained.armed;
    child.stdout.write('{"event":"exited","role":"root","pid":123,"exitCode":7}\n');
    child.emit('close', 0, null);
    await assert.rejects(retained.exited, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.applicationExitCode, 7);
        assert.equal(error.diagnostic.closeCode, 0);
        assert.equal(error.diagnostic.exitReceipt, 'rejected');
        return true;
    });
});

test('asynchronous sink failure updates terminal incomplete state without delaying actions', async () => {
    const lines: string[] = [];
    let failed = (_error?: Error | null) => {};
    const log = createNativeResourceLog('group-normal', {
        sink: (line, report) => {
            lines.push(line);
            failed = report;
        },
    });
    let body = 0;
    let cleanup = 0;
    await withNativeResourceCleanup(
        log,
        () => {
            body++;
        },
        () => {
            cleanup++;
        },
    );
    failed(new Error('SECRET asynchronous sink'));
    log.finish();
    assert.equal(body, 1);
    assert.equal(cleanup, 1);
    const terminal: unknown = JSON.parse(lines.at(-1) ?? 'null');
    assert.ok(isRecord(terminal) && isRecord(terminal.limits));
    assert.equal(terminal.event, 'SUMMARY');
    assert.equal(terminal.limits.writeFailed, true);
    assert.equal(terminal.limits.incomplete, true);
});

test('a sink failure reported after SUMMARY gets one bounded incomplete notice', async () => {
    const lines: string[] = [];
    let failed = (_error?: Error | null) => {};
    const log = createNativeResourceLog('group-normal', {
        sink: (line, report) => {
            lines.push(line);
            failed = report;
        },
    });
    await log.step('cleanup', undefined, () => {});
    log.finish();
    failed(new Error('late sink failure'));
    failed(new Error('repeated sink failure'));
    const records = lines.map((line) => {
        const value: unknown = JSON.parse(line);
        assert.ok(isRecord(value));
        return value;
    });
    assert.equal(records.at(-1)?.event, 'LIMITATION');
    assert.equal(records.filter((record) => record.event === 'LIMITATION').length, 1);
    const last = records.at(-1);
    assert.ok(last && isRecord(last.limits));
    assert.equal(last.limits.incomplete, true);
    assert.equal(last.limits.writeFailed, true);
});

test('native witness pipe errors reject both waiters using only safe evidence', async () => {
    const { child, retained, lines } = witness();
    child.stderr.emit('error', new Error('SECRET pipe C:\\private'));
    await assert.rejects(retained.armed, (error: unknown) => {
        assert.ok(error instanceof NativeFixtureFailure);
        assert.equal(error.diagnostic.errorKind, 'protocol');
        return true;
    });
    await assert.rejects(retained.exited);
    child.emit('close', 1, null);
    assert.ok(!lines.join('').includes('SECRET'));
});

test('real initial arming rejects invalid or unreadable PID files before retained cleanup exists', async () => {
    for (const mode of ['empty', 'malformed', 'read-failed'] as const) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-native-test-'));
        try {
            await writeFile(path.join(directory, 'middle-ready'), '1');
            if (mode === 'read-failed') await mkdir(path.join(directory, 'root-ready'));
            else await writeFile(path.join(directory, 'root-ready'), mode === 'empty' ? '' : 'private invalid PID');
            const { log, records } = logger();
            await assert.rejects(retainNativeResourceFixture(directory, log), (error: unknown) => {
                assert.ok(error instanceof NativeFixtureFailure);
                assert.equal(error.diagnostic.role, 'root');
                assert.equal(error.diagnostic.context, 'initial-arming');
                assert.equal(error.diagnostic.pidState, mode);
                assert.equal(error.diagnostic.spawned, false);
                assert.equal(error.diagnostic.phaseKnown, false);
                return true;
            });
            assert.equal(records()[0]?.event, 'BEGIN');
            assert.equal(records()[0]?.stage, 'initial-arming');
            assert.ok(records().some((record) => record.event === 'FAILURE' && record.stage === 'initial-arming'));
            assert.ok(!records().some((record) => record.stage === 'cleanup'));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
});

test('PowerShell invalid PID emits a controlled failure without native inspection', {
    skip: process.platform !== 'win32',
    timeout: 15_000,
}, async () => {
    const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
    }>((resolve, reject) => {
        const child = execFile(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./fixtures/native-resource-witness.ps1', import.meta.url)),
                '-OwnedPid',
                '0',
                '-Role',
                'root',
            ],
            { windowsHide: true, shell: false },
        );
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    const receipt: unknown = JSON.parse(result.stdout.trim());
    assert.ok(isRecord(receipt));
    assert.deepEqual(Object.keys(receipt).sort(), [
        'errorKind',
        'event',
        'hresult',
        'phase',
        'pid',
        'role',
        'win32Code',
    ]);
    assert.equal(receipt.event, 'failed');
    assert.equal(receipt.role, 'root');
    assert.equal(receipt.pid, 0);
    assert.equal(receipt.phase, 'inspect');
    assert.equal(receipt.errorKind, 'unexpected');
    assert.equal(receipt.win32Code, null);
    assert.ok(typeof receipt.hresult === 'number' && Number.isInteger(receipt.hresult));
});
