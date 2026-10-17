import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientContext } from '../src/application/client-context.ts';

test('request callbacks and identity are captured once even when admission facilities are mutated', async () => {
    const client = createClientContext({ registrationId: 'registration-a' });
    const observed: string[] = [];
    const facilities = {
        requestId: 0,
        capabilities: { roots: true, formElicitation: true },
        readRoots: async () => ({ roots: [{ uri: 'file:///original' }] }),
        elicit: async () => {
            observed.push('original:form');
            return { action: 'cancel' as const };
        },
        onProgress: () => observed.push('original:progress'),
    };
    const request = client.request(facilities);
    facilities.requestId = 1;
    facilities.capabilities.roots = false;
    facilities.readRoots = async () => ({ roots: [{ uri: 'file:///replacement' }] });
    facilities.elicit = async () => {
        observed.push('replacement:form');
        return { action: 'cancel' as const };
    };
    facilities.onProgress = () => observed.push('replacement:progress');
    assert.equal(request.requestId, 0);
    assert.deepEqual(await request.readRoots(), { roots: [{ uri: 'file:///original' }] });
    await request.elicit({ mode: 'form', message: 'original', requestedSchema: { type: 'object', properties: {} } });
    request.progress({ progress: 0 });
    assert.deepEqual(observed, ['original:form', 'original:progress']);
});

test('detached originating clients never forward progress or forms to another client', async () => {
    const principal = { registrationId: 'registration-a' };
    const a = createClientContext(principal);
    const b = createClientContext({ registrationId: 'registration-b' });
    const observed: string[] = [];
    const facilities = (name: string, requestId: number) => ({
        requestId,
        capabilities: { roots: true, formElicitation: true },
        readRoots: async () => ({ roots: [{ uri: `file:///${name}` }] }),
        elicit: async () => {
            observed.push(`${name}:form`);
            return { action: 'cancel' as const };
        },
        onProgress: () => observed.push(`${name}:progress`),
    });
    const origin = a.request(facilities('a', 0));
    const other = b.request(facilities('b', 0));
    assert.equal(origin.requestId, 0);
    origin.progress({ progress: 1 });
    other.progress({ progress: 1 });
    await origin.elicit({ mode: 'form', message: 'original', requestedSchema: { type: 'object', properties: {} } });
    a.detach();
    origin.progress({ progress: 2 });
    other.progress({ progress: 2 });
    await assert.rejects(
        origin.elicit({ mode: 'form', message: 'late', requestedSchema: { type: 'object', properties: {} } }),
        /originating client.*unavailable/,
    );
    assert.deepEqual(observed, ['a:progress', 'b:progress', 'a:form', 'b:progress']);
    assert.equal(origin.available(), false);
    assert.equal(other.available(), true);
    assert.equal(origin.waitSignal.aborted, true);
    assert.deepEqual(await other.readRoots(), { roots: [{ uri: 'file:///b' }] });
});
