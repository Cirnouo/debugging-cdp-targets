import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGatewayCore, type GatewayConstructionCleanup } from '../src/application/plugin-runtime.ts';

test('the trusted cleanup capability is handed out before resource acquisition and callback failure acquires nothing', async () => {
    let acquisitions = 0;
    await assert.rejects(
        createGatewayCore({
            onCleanupReady() {
                throw new Error('Embedding rejected startup.');
            },
            createRouter: async () => {
                acquisitions++;
                throw new Error('Must not acquire.');
            },
        }),
        /Embedding rejected/,
    );
    assert.equal(acquisitions, 0);
});

test('failed catalog construction retains a retryable cleanup capability until actual disposal succeeds', async () => {
    let held: GatewayConstructionCleanup | undefined;
    let fail = true;
    let closes = 0;
    await assert.rejects(
        createGatewayCore({
            onCleanupReady(value) {
                held = value;
            },
            createRouter: async () => ({
                url: 'http://127.0.0.1:30000',
                isBusy: () => false,
                setTarget() {},
                clearTarget() {},
                close: async () => {},
            }),
            createConnection: async () => ({
                tools: [],
                call: async () => ({ content: [] }),
                onExit() {},
                rootsChanged: async () => {},
                close: async () => {
                    closes++;
                    if (fail) throw new Error('Owned close refused.');
                },
            }),
            loadCatalog: async () => {
                throw new Error('Catalog rejected.');
            },
        }),
        /Catalog rejected/,
    );
    assert.ok(held);
    assert.equal(held.state(), 'failed');
    fail = false;
    await held.cleanup();
    assert.equal(held.state(), 'closed');
    assert.ok(closes >= 2);
});

test('cleanup cannot report success while catalog acquisition is pending or let its late resource escape', async () => {
    let held: GatewayConstructionCleanup | undefined;
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    let routerClosed = false;
    const creating = createGatewayCore({
        onCleanupReady(value) {
            held = value;
        },
        createRouter: async () => {
            await wait;
            return {
                url: 'http://127.0.0.1:30000',
                isBusy: () => false,
                setTarget() {},
                clearTarget() {},
                close: async () => {
                    routerClosed = true;
                },
            };
        },
    });
    assert.ok(held);
    await assert.rejects(held.cleanup(), /ownership|cleanup/i);
    assert.notEqual(held.state(), 'closed');
    release();
    await assert.rejects(creating);
    await held.cleanup();
    assert.equal(held.state(), 'closed');
    assert.equal(routerClosed, true);
});
