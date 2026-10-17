import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegistrationRegistry } from '../src/application/registrations.ts';

test('bearers are one-time creation output and principals cannot be forged or cross-authorized', () => {
    const registry = createRegistrationRegistry();
    const a = registry.create();
    const b = registry.create();
    assert.notEqual(a.bearer, b.bearer);
    assert.ok(a.bearer.length >= 43);
    assert.equal(registry.authenticate(a.bearer), a.principal);
    assert.throws(() => registry.check({ ...a.principal }), /registration/);
    registry.own('connection', a.principal);
    assert.throws(() => registry.authorize('connection', b.principal), /absent or unauthorized/);
    assert.throws(() => registry.transfer('connection', b.principal, () => true), /busy/);
    registry.transfer('connection', b.principal, () => false);
    registry.authorize('connection', b.principal);
    assert.throws(() => registry.authorize('connection', a.principal), /absent or unauthorized/);
    assert.equal(JSON.stringify(registry.list()).includes(a.bearer), false);
});

test('empty registrations expire before activity refresh; resources and nonterminal jobs block expiry', () => {
    let now = 0;
    const registry = createRegistrationRegistry({ now: () => now });
    const empty = registry.create();
    const resource = registry.create();
    const job = registry.create();
    registry.own('target', resource.principal);
    const finish = registry.beginJob(job.principal);
    now = 30 * 60 * 1000;
    assert.throws(() => registry.authenticate(empty.bearer), /expired/);
    registry.touch(resource.principal);
    registry.touch(job.principal);
    assert.throws(() => registry.unregister(resource.principal), /resources or jobs/);
    registry.release('target');
    finish();
    now += 29 * 60 * 1000;
    registry.touch(resource.principal);
    now += 60 * 1000;
    assert.throws(() => registry.check(job.principal), /expired/);
    registry.check(resource.principal);
});
