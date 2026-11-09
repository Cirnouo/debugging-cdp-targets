import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultAppConfiguration } from '../../../src/desktop/configuration/model.ts';
import { parseAppUiRequest } from '../../../src/desktop/contracts/commands.ts';

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
