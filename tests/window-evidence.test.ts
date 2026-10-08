import assert from 'node:assert/strict';
import { test } from 'node:test';

const windowFixture = () => ({
    handle: 120,
    processId: 4100,
    child: false,
    visible: true,
    executablePath: 'C:/Fixture/window.exe',
    startedAtUtc: '2026-10-05T00:00:00.000Z',
    isIconic: true,
    showCmd: 2,
    actionAccepted: true,
    nativeError: 0,
    stateReached: true,
});
const expectedWindow = {
    processId: 4100,
    executablePath: 'C:/Fixture/window.exe',
    startedAtUtc: '2026-10-05T00:00:00.000Z',
};

test('window assertions reject accepted requests without an observed transition and stale identity', async () => {
    const { readWindowSample, assertWindowState } = await import('./smoke/window-evidence.ts');
    const sample = readWindowSample([windowFixture()], expectedWindow);
    assert.equal(sample.actualExecutablePath, undefined);
    const actual = readWindowSample(
        [{ ...windowFixture(), actualExecutablePath: 'C:/FIXTUR~1/WINDOW.EXE' }],
        expectedWindow,
    );
    assert.equal(actual.actualExecutablePath, 'C:/FIXTUR~1/WINDOW.EXE');
    assert.equal(actual.executablePath, 'C:/Fixture/window.exe');
    assertWindowState(sample, 'minimized');
    for (const changed of [
        { isIconic: false, showCmd: 1 },
        { stateReached: false },
        { actionAccepted: false, nativeError: 5 },
        { showCmd: 1 },
        { nativeError: 5 },
    ]) {
        const value = readWindowSample([{ ...windowFixture(), ...changed }], expectedWindow);
        assert.throws(() => assertWindowState(value, 'minimized'));
    }
    for (const changed of [
        { processId: 4101 },
        { executablePath: 'C:/Other/window.exe' },
        { actualExecutablePath: 12 },
        { actualExecutablePath: '' },
        { startedAtUtc: '2026-10-05T00:00:01.000Z' },
        { isIconic: 'true' },
    ])
        assert.throws(() => readWindowSample([{ ...windowFixture(), ...changed }], expectedWindow));
    assert.throws(() =>
        readWindowSample([{ ...windowFixture(), startedAtUtc: '2026-10-05T00:00:00.0000002Z' }], {
            ...expectedWindow,
            startedAtUtc: '2026-10-05T00:00:00.0000001Z',
        }),
    );
    assert.throws(() => assertWindowState({ ...sample, isIconic: false, showCmd: 6 }, 'normal'));
    assert.throws(() => readWindowSample([], expectedWindow));
    assert.throws(() => readWindowSample([windowFixture(), { ...windowFixture(), handle: 121 }], expectedWindow));
    assert.throws(() => readWindowSample([windowFixture()], expectedWindow, 121));
    const replacement = readWindowSample([{ ...windowFixture(), handle: 121 }], expectedWindow);
    assert.throws(() => assertWindowState(replacement, 'minimized', sample));
    const readOnly = readWindowSample([{ ...windowFixture(), actionAccepted: null }], expectedWindow);
    assertWindowState(readOnly, 'minimized', sample);
});
