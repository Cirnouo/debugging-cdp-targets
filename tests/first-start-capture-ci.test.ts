import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    evaluateFirstStartCaptureAdmission,
    parseFirstStartCaptureEvent,
    readFirstStartCaptureAdmission,
} from './smoke/first-start-capture-ci.ts';

const sha = '1234567890abcdef1234567890abcdef12345678';
const tree = 'abcdef1234567890abcdef1234567890abcdef12';
function candidate() {
    return {
        context: {
            eventName: 'push',
            repository: 'Cirnouo/debugging-cdp-targets',
            ref: 'refs/heads/fix/chrome-startup-stall',
            sha,
            runAttempt: '1',
            runnerOs: 'Linux',
        },
        event: {
            before: '79bd8801aa3882c20cd01fca5549aea366f12d25',
            after: sha,
            ref: 'refs/heads/fix/chrome-startup-stall',
            created: false,
            deleted: false,
            forced: false,
            repository: { full_name: 'Cirnouo/debugging-cdp-targets' },
        },
        checkout: { sha, tree, objectTree: tree, clean: true },
    };
}

test('the one ordinary push transition admits only exact current checkout identity', () => {
    assert.equal(evaluateFirstStartCaptureAdmission(candidate()), 'admitted');
});

test('event type, repository, branch, attempt, SHA, tree and worktree mismatches close admission', () => {
    const cases: [string, string, unknown][] = [
        ['context', 'eventName', 'pull_request'],
        ['context', 'eventName', 'pull_request_target'],
        ['context', 'eventName', 'workflow_dispatch'],
        ['context', 'eventName', 'schedule'],
        ['context', 'eventName', 'workflow_call'],
        ['context', 'runAttempt', '2'],
        ['context', 'runAttempt', 1],
        ['context', 'runAttempt', '01'],
        ['context', 'repository', 'other/debugging-cdp-targets'],
        ['context', 'runnerOs', 'macOS'],
        ['context', 'ref', 'refs/pull/46/merge'],
        ['context', 'sha', 'f'.repeat(40)],
        ['event', 'before', 'f'.repeat(40)],
        ['event', 'after', 'f'.repeat(40)],
        ['event', 'ref', 'refs/heads/main'],
        ['event', 'created', true],
        ['event', 'deleted', true],
        ['event', 'forced', true],
        ['event', 'forced', 'false'],
        ['event', 'repository', { full_name: 'other/debugging-cdp-targets' }],
        ['checkout', 'sha', 'f'.repeat(40)],
        ['checkout', 'tree', 'f'.repeat(40)],
        ['checkout', 'objectTree', 'f'.repeat(40)],
        ['checkout', 'clean', false],
    ];
    for (const [section, key, value] of cases) {
        const input = candidate();
        const changed = { ...input, [section]: { ...Reflect.get(input, section), [key]: value } };
        assert.equal(evaluateFirstStartCaptureAdmission(changed), 'ineligible', `${section}.${key}`);
    }
});

test('missing, accessor, hostile or malformed inputs fail closed without reading getters or private output', () => {
    for (const input of [undefined, null, [], {}, { ...candidate(), event: null }]) {
        assert.equal(evaluateFirstStartCaptureAdmission(input), 'ineligible');
    }
    for (const section of ['context', 'event', 'checkout'] as const) {
        for (const key of Object.keys(candidate()[section])) {
            const input = candidate();
            Reflect.deleteProperty(input[section], key);
            assert.equal(evaluateFirstStartCaptureAdmission(input), 'ineligible', `${section}.${key}`);
        }
    }
    let getterReads = 0;
    const event = Object.defineProperty(candidate().event, 'before', {
        get() {
            getterReads++;
            return '/private/token';
        },
    });
    assert.equal(evaluateFirstStartCaptureAdmission({ ...candidate(), event }), 'ineligible');
    assert.equal(getterReads, 0);
    assert.equal(
        evaluateFirstStartCaptureAdmission(
            new Proxy(
                {},
                {
                    getOwnPropertyDescriptor() {
                        throw Error('/private');
                    },
                },
            ),
        ),
        'ineligible',
    );
});

test('bounded event parsing rejects oversize, invalid UTF-8 and malformed JSON', () => {
    assert.deepEqual(parseFirstStartCaptureEvent(Buffer.from(JSON.stringify(candidate().event))), candidate().event);
    for (const input of [Buffer.alloc(262_145, 32), Buffer.from('{'), Buffer.from([0xff]), 'private', null]) {
        assert.equal(parseFirstStartCaptureEvent(input), undefined);
    }
});

function environment() {
    return {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REPOSITORY: 'Cirnouo/debugging-cdp-targets',
        GITHUB_REF: 'refs/heads/fix/chrome-startup-stall',
        GITHUB_SHA: sha,
        GITHUB_RUN_ATTEMPT: '1',
        RUNNER_OS: 'Linux',
        GITHUB_EVENT_PATH: path.resolve('synthetic-event.json'),
    };
}

test('CI I/O adapter admits valid event and checkout, suppresses acquisition for ineligible contexts', () => {
    const calls: string[] = [];
    const io = {
        readEvent: (file: string) => {
            assert.equal(file, path.resolve('synthetic-event.json'));
            calls.push('read');
            return Buffer.from(JSON.stringify(candidate().event));
        },
        checkout: (expected: string) => {
            assert.equal(expected, sha);
            calls.push('checkout');
            return candidate().checkout;
        },
    };
    assert.equal(readFirstStartCaptureAdmission(environment(), io), 'admitted');
    assert.deepEqual(calls, ['read', 'checkout']);
    calls.length = 0;
    for (const eventName of ['pull_request', 'workflow_dispatch', 'schedule', undefined]) {
        assert.equal(
            readFirstStartCaptureAdmission({ ...environment(), GITHUB_EVENT_NAME: eventName }, io),
            'ineligible',
        );
    }
    assert.deepEqual(calls, []);
});

test('missing, relative, oversized, unreadable and malformed events or failed git evidence expose only safe admission statuses', () => {
    const io = {
        readEvent: () => Buffer.from(JSON.stringify(candidate().event)),
        checkout: () => candidate().checkout,
    };
    for (const GITHUB_EVENT_PATH of [undefined, 'relative.json', '', '/'.repeat(4_097)]) {
        assert.equal(readFirstStartCaptureAdmission({ ...environment(), GITHUB_EVENT_PATH }, io), 'unavailable');
    }
    for (const bytes of [Buffer.alloc(262_145), Buffer.from('{'), Buffer.from([0xff])]) {
        assert.equal(readFirstStartCaptureAdmission(environment(), { ...io, readEvent: () => bytes }), 'unavailable');
    }
    const fail = () => {
        throw Error('/private/token');
    };
    assert.equal(readFirstStartCaptureAdmission(environment(), { ...io, readEvent: fail }), 'unavailable');
    assert.equal(readFirstStartCaptureAdmission(environment(), { ...io, checkout: fail }), 'unavailable');
    assert.equal(
        readFirstStartCaptureAdmission(environment(), {
            ...io,
            checkout: () => ({ ...candidate().checkout, sha: 'f'.repeat(40) }),
        }),
        'ineligible',
    );
});

test('native event acquisition rejects oversized files and malformed private contents before checkout', (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dct-capture-gate-'));
    const eventFile = path.join(directory, 'event.json');
    t.after(() => {
        unlinkSync(eventFile);
        rmdirSync(directory);
    });
    for (const content of [Buffer.alloc(262_145, 32), Buffer.from('{"private":"TOKEN"'), Buffer.from([0xff])]) {
        writeFileSync(eventFile, content);
        assert.equal(readFirstStartCaptureAdmission({ ...environment(), GITHUB_EVENT_PATH: eventFile }), 'unavailable');
    }
    assert.equal(
        readFirstStartCaptureAdmission({ ...environment(), GITHUB_EVENT_PATH: path.join(directory, 'missing.json') }),
        'unavailable',
    );
});
