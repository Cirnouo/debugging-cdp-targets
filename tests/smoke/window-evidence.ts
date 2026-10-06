import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../../src/shared/errors.ts';

export interface WindowIdentity {
    processId: number;
    executablePath: string;
    startedAtUtc: string;
}
export interface WindowSample extends WindowIdentity {
    actualExecutablePath?: string;
    handle: number;
    isIconic: boolean;
    showCmd: number;
    actionAccepted: boolean | null;
    nativeError: number;
    stateReached: boolean;
    foregroundHwnd?: number;
    bounds?: WindowBounds;
}
export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

function creationTicks(value: string): bigint {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    assert.ok(match?.[1] && match[3], 'Invalid process creation time.');
    const seconds = Date.parse(`${match[1]}${match[3]}`);
    assert.ok(Number.isFinite(seconds), 'Invalid process creation time.');
    return BigInt(seconds) * 10_000n + BigInt((match[2] ?? '').padEnd(7, '0'));
}

export function readWindowSample(value: unknown, expected: WindowIdentity, handle?: number): WindowSample {
    assert.ok(Array.isArray(value), 'Expected a window evidence array.');
    const windows = value.filter(isRecord).filter((item) => item.child === false && item.visible === true);
    const selected = handle === undefined ? windows : windows.filter((item) => item.handle === handle);
    assert.equal(selected.length, 1, 'Expected one explicitly identified visible top-level window.');
    const window = selected[0];
    assert.ok(window);
    assert.equal(window.processId, expected.processId, 'Window owner changed.');
    assert.ok(typeof window.executablePath === 'string');
    if (window.actualExecutablePath !== undefined) {
        assert.ok(typeof window.actualExecutablePath === 'string' && window.actualExecutablePath.length > 0);
    }
    assert.equal(
        path.win32.normalize(window.executablePath).toLowerCase(),
        path.win32.normalize(expected.executablePath).toLowerCase(),
        'Window executable changed.',
    );
    assert.ok(typeof window.startedAtUtc === 'string');
    assert.equal(
        creationTicks(window.startedAtUtc),
        creationTicks(expected.startedAtUtc),
        'Window creation time changed.',
    );
    assert.ok(typeof window.handle === 'number' && Number.isSafeInteger(window.handle) && window.handle > 0);
    assert.ok(typeof window.isIconic === 'boolean' && typeof window.stateReached === 'boolean');
    assert.ok(typeof window.showCmd === 'number' && Number.isInteger(window.showCmd));
    assert.ok(window.actionAccepted === null || typeof window.actionAccepted === 'boolean');
    assert.ok(typeof window.nativeError === 'number' && Number.isInteger(window.nativeError));
    if (window.foregroundHwnd !== undefined)
        assert.ok(
            typeof window.foregroundHwnd === 'number' &&
                Number.isSafeInteger(window.foregroundHwnd) &&
                window.foregroundHwnd >= 0,
        );
    let bounds: WindowBounds | undefined;
    if ([window.x, window.y, window.width, window.height].some((value) => value !== undefined)) {
        assert.ok(typeof window.x === 'number' && Number.isSafeInteger(window.x));
        assert.ok(typeof window.y === 'number' && Number.isSafeInteger(window.y));
        assert.ok(typeof window.width === 'number' && Number.isSafeInteger(window.width) && window.width > 0);
        assert.ok(typeof window.height === 'number' && Number.isSafeInteger(window.height) && window.height > 0);
        bounds = { x: window.x, y: window.y, width: window.width, height: window.height };
    }
    return {
        processId: expected.processId,
        executablePath: window.executablePath,
        ...(window.actualExecutablePath === undefined ? {} : { actualExecutablePath: window.actualExecutablePath }),
        startedAtUtc: window.startedAtUtc,
        handle: window.handle,
        isIconic: window.isIconic,
        showCmd: window.showCmd,
        actionAccepted: window.actionAccepted,
        nativeError: window.nativeError,
        stateReached: window.stateReached,
        ...(window.foregroundHwnd === undefined ? {} : { foregroundHwnd: window.foregroundHwnd }),
        ...(bounds === undefined ? {} : { bounds }),
    };
}

export function assertWindowState(sample: WindowSample, state: 'normal' | 'minimized', previous?: WindowSample) {
    assert.notEqual(sample.actionAccepted, false, `Window action failed with native error ${sample.nativeError}.`);
    assert.equal(sample.nativeError, 0, 'Successful or read-only observation contains a native error.');
    assert.equal(sample.stateReached, true, 'Window transition was not observed within five seconds.');
    assert.equal(sample.isIconic, state === 'minimized', 'Observed window state differs from the requested state.');
    assert.ok(
        sample.isIconic ? [2, 6, 7].includes(sample.showCmd) : [1, 3, 4, 5, 8, 9, 10].includes(sample.showCmd),
        'Placement contradicts the minimized state.',
    );
    if (previous) {
        assert.equal(sample.handle, previous.handle, 'Window handle changed during screenshot.');
        assert.equal(sample.processId, previous.processId, 'Window owner changed during screenshot.');
        assert.equal(sample.startedAtUtc, previous.startedAtUtc, 'Window process changed during screenshot.');
    }
}

export async function sampleWindow(expected: WindowIdentity, state: 'None' | 'Minimize' | 'Restore', handle?: number) {
    const result = await promisify(execFile)(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            fileURLToPath(new URL('./windows-window-evidence.ps1', import.meta.url)),
            '-ApplicationPid',
            String(expected.processId),
            '-ExecutablePath',
            expected.executablePath,
            '-StartedAtUtc',
            expected.startedAtUtc,
            '-State',
            state,
            ...(handle === undefined ? [] : ['-WindowHandle', String(handle)]),
        ],
        { windowsHide: true, shell: false },
    );
    const value: unknown = JSON.parse(result.stdout);
    const sample = readWindowSample(value, expected, handle);
    assert.ok(
        typeof sample.actualExecutablePath === 'string',
        'Native window evidence requires the observed executable path.',
    );
    return sample;
}
