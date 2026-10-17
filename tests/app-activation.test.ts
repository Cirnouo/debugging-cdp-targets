import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { activateExistingApp, listenForAppActivation } from '../src/adapters/app-activation.ts';

test('singleton activation carries one fixed bounded request and acknowledgement only', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-activation-'));
    const endpoint =
        process.platform === 'win32'
            ? `\\\\.\\pipe\\dct-test-${path.basename(directory)}`
            : path.join(directory, 'activation.sock');
    let activations = 0;
    const listener = await listenForAppActivation({
        ownsSingleton: true,
        endpoint,
        activate: () => {
            activations++;
        },
    });
    try {
        assert.equal(await activateExistingApp(endpoint), true);
        assert.equal(activations, 1);
        for (const payload of ['activate-v1\nadmin\n', '{"command":"close-all"}\n', 'x'.repeat(128)]) {
            await new Promise<void>((resolve, reject) => {
                const socket = connect(endpoint, () => socket.end(payload));
                socket.on('error', reject);
                socket.on('close', () => resolve());
            });
        }
        assert.equal(activations, 1);
        await assert.rejects(
            listenForAppActivation({ ownsSingleton: false, endpoint, activate: () => {} }),
            /singleton/i,
        );
    } finally {
        await listener.close();
        await rm(directory, { recursive: true, force: true });
    }
    assert.equal(await activateExistingApp(endpoint), false);
});

test('one complete activation frame closes the stream without processing a second packet', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-activation-prefix-'));
    const endpoint =
        process.platform === 'win32'
            ? `\\\\.\\pipe\\dct-test-${path.basename(directory)}`
            : path.join(directory, 'activation.sock');
    let activations = 0;
    const listener = await listenForAppActivation({
        ownsSingleton: true,
        endpoint,
        activate: () => {
            activations++;
        },
    });
    try {
        await new Promise<void>((resolve) => {
            const socket = connect(endpoint, () => {
                socket.write('activate-v1\n');
                setTimeout(() => socket.end('admin\n'), 20);
            });
            socket.on('error', () => {});
            socket.on('data', () => {});
            socket.on('close', () => resolve());
        });
        assert.equal(activations, 1);
    } finally {
        await listener.close();
        await rm(directory, { recursive: true, force: true });
    }
});
