import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    parseOfficialToolArguments,
    parseRegistrationBearerArguments,
} from '../../src/gateway/owned-tool-arguments.ts';

const registrationBearer = 'a'.repeat(43);
const connectionId = 'c1e40000-1111-4111-8111-111111111111';
const sessionId = 'c1e40000-2222-4222-8222-222222222222';

test('lifecycle bearer extraction is explicit per request and never mutates the supplied arguments', () => {
    const source = { registrationBearer, requestId: 'fresh', action: 'status' };
    const parsed = parseRegistrationBearerArguments(source);
    assert.equal(parsed.registrationBearer, registrationBearer);
    assert.deepEqual(parsed.arguments, { requestId: 'fresh', action: 'status' });
    assert.equal(source.registrationBearer, registrationBearer);
    for (const value of [null, [], {}, { registrationBearer: null }, { registrationBearer: 'private token\n' }]) {
        assert.throws(
            () => parseRegistrationBearerArguments(value),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.equal(error.message.includes('private token'), false);
                return true;
            },
        );
    }
});

test('official routing extracts only its own bearer and removes the whole gateway route from original arguments', () => {
    const route = { registrationBearer, connectionId, sessionId };
    const source = { url: 'https://example.invalid', _dct: route, registrationBearer: 'official tool argument' };
    const parsed = parseOfficialToolArguments(source);
    assert.equal(parsed.registrationBearer, registrationBearer);
    assert.deepEqual(parsed.route, { connectionId, sessionId });
    assert.deepEqual(parsed.arguments, { url: source.url, registrationBearer: 'official tool argument' });
    assert.equal(source._dct, route);
    for (const _dct of [
        undefined,
        null,
        { connectionId, sessionId },
        { ...route, admin: true },
        { ...route, sessionId: 'stale' },
    ])
        assert.throws(() => parseOfficialToolArguments({ _dct }));
});
