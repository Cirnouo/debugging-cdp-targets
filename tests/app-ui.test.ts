import assert from 'node:assert/strict';
import { test } from 'node:test';
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
