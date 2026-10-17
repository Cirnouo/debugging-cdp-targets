import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as management from '../src/domains/app-ui.ts';

test('management accepts explicit scoped routes and rejects stale-shape or unsafe batch requests', () => {
    const route = {
        connectionId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
    };
    assert.deepEqual(parseAppUiRequest({ action: 'manage', command: { kind: 'restart', route, scope: 'official' } }), {
        action: 'manage',
        command: { kind: 'restart', route, scope: 'official' },
    });
    for (const command of [
        { kind: 'start' },
        { kind: 'restart', route },
        { kind: 'restart', route, scope: 'auto' },
        { kind: 'close', routes: [] },
        { kind: 'close', routes: [route, route] },
        { kind: 'transfer', routes: [route], registrationId: 'secret' },
        { kind: 'host-sync', host: 'other' },
    ])
        assert.throws(() => parseAppUiRequest({ action: 'manage', command }));
});

test('elapsed clocks retain hours above 24, clamp future timestamps and show unavailable evidence', () => {
    const format: unknown = Reflect.get(management, 'formatAppElapsed');
    assert.equal(typeof format, 'function', 'elapsed clock formatter is available');
    if (typeof format !== 'function') return;
    assert.equal(format(0, 90_061_000), '25:01:01');
    assert.equal(format(10_000, 1_000), '00:00:00');
    for (const timestamp of [undefined, null, NaN, Infinity, -1]) assert.equal(format(timestamp, 1000), 'Unavailable');
});

import { defaultAppConfiguration } from '../src/domains/app-configuration.ts';
import { appAssetPath, parseAppUiRequest, parseAppUiSnapshot } from '../src/domains/app-ui.ts';

test('the secure App scheme serves only fixed manager assets with exact authority and method', () => {
    assert.equal(appAssetPath('dct-app://manager/app.css', 'GET', 'dct-app://manager'), '/app.css');
    assert.equal(appAssetPath('dct-app://manager/', 'GET', undefined), '/');
    for (const url of [
        'file:///private',
        'https://manager/app.css',
        'dct-app://other/app.css',
        'dct-app://manager:42/app.css',
        'dct-app://user@manager/app.css',
        'dct-app://manager/app.css?q=1',
        'dct-app://manager/private',
        'not a URL',
    ])
        assert.equal(appAssetPath(url, 'GET', undefined), undefined);
    assert.equal(appAssetPath('dct-app://manager/', 'POST', undefined), undefined);
    assert.equal(appAssetPath('dct-app://manager/', 'GET', 'https://untrusted.invalid'), undefined);
});

test('the management channel accepts only bounded named actions and validated settings', () => {
    for (const action of ['inspect', 'quit', 'restart']) assert.deepEqual(parseAppUiRequest({ action }), { action });
    assert.deepEqual(parseAppUiRequest({ action: 'configure', configuration: defaultAppConfiguration() }), {
        action: 'configure',
        configuration: defaultAppConfiguration(),
    });
    for (const request of [
        null,
        {},
        { action: 'start' },
        { action: 'inspect', command: 'shell' },
        { action: 'quit', force: true },
        { action: 'configure', configuration: { schemaVersion: 999 } },
    ])
        assert.throws(() => parseAppUiRequest(request));
});

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
