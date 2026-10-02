import assert from 'node:assert/strict';
import test from 'node:test';
import { controlEndpoint } from '../src/adapters/control-ipc.ts';

const entryId = '11111111-1111-4111-8111-111111111111';
const secondEntryId = '22222222-2222-4222-8222-222222222222';
const macDirectory = '/var/folders/36/tjdph2t965j8snz9_vkdnw0r0000gn/T';
const environment = {
    platform: 'darwin',
    tmpdir: macDirectory,
    user: { username: 'runner', homedir: '/Users/runner' },
};

test('control endpoints fit the Unix socket byte limit with the macOS CI temporary directory', () => {
    for (const platform of ['darwin', 'linux']) {
        const endpoint = controlEndpoint(entryId, { ...environment, platform });
        assert.ok(endpoint.startsWith(`${macDirectory}/`));
        assert.ok(Buffer.byteLength(endpoint, 'utf8') <= 103);
    }
});

test('control endpoints are deterministic and isolate entry and user identities', () => {
    const endpoint = controlEndpoint(entryId, environment);
    assert.equal(controlEndpoint(entryId, environment), endpoint);
    assert.notEqual(controlEndpoint(secondEntryId, environment), endpoint);
    assert.notEqual(
        controlEndpoint(entryId, { ...environment, user: { ...environment.user, username: 'other' } }),
        endpoint,
    );
    assert.notEqual(
        controlEndpoint(entryId, { ...environment, user: { ...environment.user, homedir: '/Users/other' } }),
        endpoint,
    );
});

test('control endpoints reject temporary directories that exceed the Unix UTF-8 byte limit', () => {
    const boundary = controlEndpoint(entryId, { ...environment, tmpdir: `/${'临'.repeat(20)}` });
    assert.equal(Buffer.byteLength(boundary, 'utf8'), 103);
    assert.throws(
        () => controlEndpoint(entryId, { ...environment, tmpdir: `/${'a'.repeat(103)}` }),
        /Unix control endpoint exceeds the 103-byte socket path limit/,
    );
    assert.throws(
        () => controlEndpoint(entryId, { ...environment, tmpdir: `/${'临'.repeat(21)}` }),
        /Unix control endpoint exceeds the 103-byte socket path limit/,
    );
});

test('control endpoints preserve Windows named pipe routing and validate entry IDs', () => {
    const windows = { ...environment, platform: 'win32' };
    const endpoint = controlEndpoint(entryId, windows);
    assert.equal(endpoint, '\\\\.\\pipe\\debugging-cdp-targets-3004cb7afeff6824-11111111-1111-4111-8111-111111111111');
    assert.notEqual(controlEndpoint(secondEntryId, windows), endpoint);
    for (const platform of ['darwin', 'linux', 'win32']) {
        assert.throws(() => controlEndpoint('invalid', { ...environment, platform }), /entry ID/);
    }
});
