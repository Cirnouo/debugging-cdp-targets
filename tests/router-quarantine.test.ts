import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { createCdpRouter } from '../src/adapters/cdp-router.ts';
import type { Diagnostic } from '../src/shared/diagnostics.ts';

test('quarantine aborts outstanding discovery and clears pending state before another session can attach', async () => {
    let observed: () => void = () => {};
    const requestArrived = new Promise<void>((resolve) => {
        observed = resolve;
    });
    const target = http.createServer(() => observed());
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    assert.ok(address && typeof address !== 'string');
    const router = await createCdpRouter();
    try {
        router.setTarget({ port: address.port });
        const pending = fetch(`${router.url}/json/version`).catch(() => undefined);
        await requestArrived;
        assert.equal(router.isBusy(), true);
        router.clearTarget();
        assert.equal(router.isBusy(), false);
        assert.equal(await pending, undefined);
        router.setTarget({ port: address.port });
        assert.equal(router.isBusy(), false);
    } finally {
        await router.close();
        target.closeAllConnections();
        await new Promise<void>((resolve) => target.close(() => resolve()));
    }
});

test('disconnect clears unanswered CDP requests and records only phase timing metadata', async () => {
    const server = http.createServer();
    const sockets = new WebSocketServer({ server });
    let arrived: () => void = () => {};
    const received = new Promise<void>((resolve) => {
        arrived = resolve;
    });
    sockets.on('connection', (socket) => socket.on('message', () => arrived()));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const diagnostics: Diagnostic[] = [];
    const router = await createCdpRouter({ diagnose: (event) => diagnostics.push(event) });
    router.setTarget({ port: address.port });
    const client = new WebSocket(`${router.url.replace('http:', 'ws:')}/devtools/browser/test`);
    try {
        await new Promise<void>((resolve, reject) => {
            client.once('open', resolve);
            client.once('error', reject);
        });
        client.send(
            JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { private: 'never-record-this' } }),
        );
        await received;
        assert.equal(router.isBusy(), true);
        const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
        router.clearTarget();
        await closed;
        assert.equal(router.isBusy(), false);
        assert.ok(diagnostics.some((event) => event.phase === 'cdp-screenshot' && event.outcome === 'interrupted'));
        assert.ok(diagnostics.every((event) => Object.keys(event).sort().join() === 'elapsedMs,outcome,phase'));
        assert.equal(JSON.stringify(diagnostics).includes('never-record-this'), false);
    } finally {
        client.terminate();
        await router.close();
        for (const socket of sockets.clients) socket.terminate();
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
