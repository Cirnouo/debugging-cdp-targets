import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultAppConfiguration } from '../../../src/desktop/configuration/model.ts';
import * as management from '../../../src/desktop/contracts/snapshots.ts';
import { parseAppUiSnapshot } from '../../../src/desktop/contracts/snapshots.ts';

test('management snapshots carry desired/effective settings and reject secret or runtime state fields', () => {
    const configuration = defaultAppConfiguration();
    const snapshot = {
        phase: 'ready',
        configuration: { desired: configuration, effective: configuration, restartRequired: false },
    };
    assert.deepEqual(parseAppUiSnapshot(snapshot), snapshot);
    for (const value of [
        { ...snapshot, bearer: 'never-read-back' },
        { ...snapshot, phase: 'unverified' },
        { ...snapshot, configuration: { ...snapshot.configuration, restartRequired: true } },
        { ...snapshot, message: 'x'.repeat(501) },
        {
            ...snapshot,
            configuration: {
                ...snapshot.configuration,
                effective: {
                    ...configuration,
                    hosts: {
                        ...configuration.hosts,
                        codex: { ...configuration.hosts.codex, configRoot: '/another-root' },
                    },
                },
            },
        },
    ])
        assert.throws(() => parseAppUiSnapshot(value));
});

test('configuration failure can be displayed without inventing settings or a ready endpoint', () => {
    const failed = { phase: 'failed', message: 'The configuration could not be loaded.' };
    assert.deepEqual(parseAppUiSnapshot(failed), failed);
    assert.deepEqual(parseAppUiSnapshot({ phase: 'starting' }), { phase: 'starting' });
    assert.throws(() => parseAppUiSnapshot({ phase: 'ready' }));
    assert.throws(() => parseAppUiSnapshot({ phase: 'failed' }));
});

test('management snapshot validators reject undefined identities and nested authority or native output', () => {
    const settings = defaultAppConfiguration();
    const management = { registrations: [], connections: [], operations: [], hosts: [] };
    const snapshot = {
        phase: 'ready',
        configuration: { desired: settings, effective: settings, restartRequired: false },
        management,
    };
    for (const changed of [
        { ...management, registrations: [{ registrationId: undefined, resources: 0, jobs: 0 }] },
        {
            ...management,
            registrations: [
                { registrationId: '11111111-1111-4111-8111-111111111111', resources: 0, jobs: 0, bearer: 'secret' },
            ],
        },
        {
            ...management,
            hosts: [{ host: 'codex', state: 'failed', activation: 'unverified', stdout: 'native output' }],
        },
    ])
        assert.throws(() => parseAppUiSnapshot({ ...snapshot, management: changed }));
});

test('pending connection summaries preserve an unavailable public session instead of inventing one from a generation', () => {
    const configuration = defaultAppConfiguration();
    const snapshot = {
        phase: 'ready',
        configuration: { desired: configuration, effective: configuration, restartRequired: false },
        management: {
            registrations: [],
            operations: [],
            hosts: [],
            connections: [
                {
                    connectionId: '11111111-1111-4111-8111-111111111111',
                    status: 'starting',
                    targetGeneration: '22222222-2222-4222-8222-222222222222',
                    officialGeneration: '33333333-3333-4333-8333-333333333333',
                },
            ],
        },
    };
    assert.deepEqual(parseAppUiSnapshot(snapshot), snapshot);
});

test('selected operation IPC permits only bounded evidence and keeps rich detail out of ordinary summaries', () => {
    const summary = {
        operationId: '11111111-1111-4111-8111-111111111111',
        requestId: 'failed-start',
        action: 'start',
        state: 'failed',
        phase: 'failed',
        elapsedMs: 12,
        cursor: 3,
    };
    const base = { registrations: [], connections: [], operations: [summary], hosts: [] };
    const selectedOperation = {
        ...summary,
        error: { kind: 'start-failed', category: 'access-denied', nativeError: 5 },
        isolation: {
            mode: 'data-dir',
            path: '/explicit-fixture',
            cleanup: 'delete-on-release',
            state: 'cleanup-failed',
        },
        wait: { cursor: 3, complete: true, replayTruncated: false },
    };
    assert.deepEqual(
        management.parseAppManagementSnapshot({ ...base, selectedOperation }).selectedOperation,
        selectedOperation,
    );
    for (const changed of [
        { ...base, operations: [selectedOperation] },
        { ...base, selectedOperation: { ...selectedOperation, payload: 'arbitrary' } },
        ...[
            { kind: 'start-failed', message: '/private raw error' },
            { kind: 'start-failed', category: 'secret-token' },
            { kind: 'start-failed', code: 'secret-token' },
            { kind: 'start-failed', phase: '/private' },
            { kind: 'start-failed', nativeError: NaN },
            { kind: 'start-failed', processExited: 'yes' },
            { kind: 'start-failed', listenerState: 'secret' },
        ].map((error) => ({ ...base, selectedOperation: { ...selectedOperation, error } })),
        { ...base, selectedOperation: { ...summary, result: { arbitrary: '/private' } } },
        { ...base, selectedOperation: { ...summary, result: { status: '/private' } } },
        { ...base, selectedOperation: { ...summary, result: { connectionId: 'secret' } } },
        {
            ...base,
            selectedOperation: { ...selectedOperation, isolation: { ...selectedOperation.isolation, token: 'secret' } },
        },
        {
            ...base,
            selectedOperation: { ...selectedOperation, wait: { cursor: 3, complete: 'yes', replayTruncated: false } },
        },
    ])
        assert.throws(() => management.parseAppManagementSnapshot(changed));
});
