import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { createOfficialConnection } from '../src/adapters/mcp-bridge.ts';
import { isRecord } from '../src/shared/errors.ts';

type Resource = { close(): Promise<void>; onExit(listener: () => void): void };

async function within<T>(promise: Promise<T>, milliseconds: number, description: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(description)), milliseconds);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function alive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function marker(directory: string, name: string) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        try {
            const value: unknown = JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8'));
            assert.ok(isRecord(value));
            assert.equal(typeof value.pid, 'number');
            assert.equal(typeof value.time, 'number');
            return value;
        } catch (error) {
            if (!isRecord(error) || error.code !== 'ENOENT') throw error;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Fixture did not reach ${name}.`);
}

async function fixture(mode = 'resist') {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-official-child-'));
    return {
        directory,
        options: {
            bin: fileURLToPath(new URL('./fixtures/official-child.ts', import.meta.url)),
            args: [directory, mode],
        },
        async cleanup() {
            try {
                const evidence = await marker(directory, 'started');
                assert.equal(typeof evidence.pid, 'number');
                if (typeof evidence.pid === 'number' && alive(evidence.pid)) process.kill(evidence.pid, 'SIGKILL');
            } catch (error) {
                if (!(error instanceof Error) || !error.message.includes('Fixture did not reach started.')) throw error;
            }
            await rm(directory, { recursive: true, force: true });
        },
    };
}

test('logical official close settles pending SDK calls before owned child exit and reaps an EOF-resistant child', async () => {
    const child = await fixture();
    let protocolCloses = 0;
    const originalConnect = Client.prototype.connect;
    const observingProtocol = mock.method(
        Client.prototype,
        'connect',
        async function (this: Client, ...args: Parameters<Client['connect']>) {
            await Reflect.apply(originalConnect, this, args);
            this.onclose = () => protocolCloses++;
        },
    );
    const connection = await createOfficialConnection('http://127.0.0.1:9222', child.options);
    observingProtocol.mock.restore();
    let close: Promise<void> | undefined;
    let exits = 0;
    connection.onExit(() => exits++);
    try {
        const evidence = await marker(child.directory, 'started');
        assert.equal(typeof evidence.pid, 'number');
        if (typeof evidence.pid !== 'number') throw new Error('Expected fixture PID.');
        let began: () => void = () => {};
        const beginning = new Promise<void>((resolve) => {
            began = resolve;
        });
        const pending = connection.call('hold', {}, undefined, () => began());
        void pending.catch(() => {});
        await within(beginning, 1000, 'Pending call did not enter.');
        close = connection.close();
        void close.catch(() => {});
        const secondClose = connection.close();
        void secondClose.catch(() => {});
        await within(assert.rejects(pending, /Connection closed/), 400, 'Logical close left SDK call pending.');
        assert.equal(protocolCloses, 1);
        assert.equal(exits, 0);
        assert.equal(alive(evidence.pid), true);
        await within(assert.rejects(connection.call('hold', {})), 400, 'Closed bridge still forwards calls.');
        await within(Promise.all([close, secondClose]), 10_500, 'Official owned child was not reaped.');
        assert.equal(exits, 1);
        assert.equal(alive(evidence.pid), false);
        const eof = await marker(child.directory, 'eof');
        assert.ok(Date.now() - Number(eof.time) >= 1700, 'EOF grace must precede signalling.');
        if (process.platform !== 'win32') {
            const term = await marker(child.directory, 'term');
            assert.ok(Number(term.time) - Number(eof.time) >= 1700);
            assert.ok(Date.now() - Number(term.time) >= 1700, 'TERM grace must precede KILL.');
        }
        let retainedExits = 0;
        connection.onExit(() => retainedExits++);
        await connection.close();
        assert.equal(exits, 1);
        assert.equal(retainedExits, 1);
        assert.equal(protocolCloses, 1);
    } finally {
        observingProtocol.mock.restore();
        await child.cleanup();
        await close?.catch(() => {});
        await connection.close().catch(() => {});
    }
});

test('official process exit is observed while inherited stdio pipes remain open', async () => {
    const child = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', child.options);
    const originalEmit = ChildProcess.prototype.emit;
    const delayedClose =
        process.platform === 'win32'
            ? mock.method(
                  ChildProcess.prototype,
                  'emit',
                  function (this: ChildProcess, event: string | symbol, ...args: unknown[]) {
                      if (event === 'close') {
                          setTimeout(() => Reflect.apply(originalEmit, this, [event, ...args]), 1800);
                          return true;
                      }
                      return Reflect.apply(originalEmit, this, [event, ...args]);
                  },
              )
            : undefined;
    let exited: () => void = () => {};
    const exit = new Promise<void>((resolve) => {
        exited = resolve;
    });
    connection.onExit(exited);
    try {
        const pending = connection.call('hold', { exitWithHeldPipes: true });
        void pending.catch(() => {});
        await within(exit, 700, 'Bridge waited for inherited stdio close instead of owned child exit.');
        await within(assert.rejects(pending, /Connection closed/), 400, 'Actual exit left SDK call pending.');
        await within(connection.close(), 400, 'Already exited child waited for stdio close.');
    } finally {
        delayedClose?.mock.restore();
        await child.cleanup();
        await connection.close().catch(() => {});
    }
});

test('stdio ending closes the protocol without fabricating an actual child exit', async () => {
    const child = await fixture();
    let ownedChild: ChildProcess | undefined;
    const originalEmit = ChildProcess.prototype.emit;
    const observing = mock.method(
        ChildProcess.prototype,
        'emit',
        function (this: ChildProcess, event: string | symbol, ...args: unknown[]) {
            if (event === 'spawn') ownedChild = this;
            return Reflect.apply(originalEmit, this, [event, ...args]);
        },
    );
    const connection = await createOfficialConnection('http://127.0.0.1:9222', child.options);
    observing.mock.restore();
    let exits = 0;
    connection.onExit(() => exits++);
    try {
        const pending = connection.call('hold', { disconnect: true });
        void pending.catch(() => {});
        await marker(child.directory, 'disconnected');
        assert.ok(ownedChild?.stdout);
        ownedChild.stdout.destroy();
        await within(assert.rejects(pending, /Connection closed/), 400, 'Ended stdout left protocol pending.');
        assert.equal(exits, 0);
        const evidence = await marker(child.directory, 'started');
        assert.equal(typeof evidence.pid, 'number');
        if (typeof evidence.pid !== 'number') throw new Error('Expected fixture PID.');
        assert.equal(alive(evidence.pid), true);
        await connection.close();
        assert.equal(exits, 1);
    } finally {
        observing.mock.restore();
        await child.cleanup();
        await connection.close().catch(() => {});
    }
});

for (const phase of ['initialize', 'listing']) {
    test(`official acquisition exposes its owned resource before ${phase} and abort settles protocol immediately`, async () => {
        const child = await fixture(phase);
        const controller = new AbortController();
        let resource: Resource | undefined;
        const creating = createOfficialConnection('http://127.0.0.1:9222', {
            ...child.options,
            signal: controller.signal,
            onAcquired: (value: Resource) => {
                resource = value;
            },
        });
        void creating.catch(() => {});
        try {
            assert.ok(resource, 'Spawned resource must be synchronously owned before any protocol await.');
            await marker(child.directory, phase);
            controller.abort(new Error('Cancelled acquisition'));
            await within(assert.rejects(creating), 400, 'Abort left acquisition pending until physical cleanup.');
            const messages = (await readFile(path.join(child.directory, 'messages.jsonl'), 'utf8'))
                .trim()
                .split('\n')
                .map((line): unknown => JSON.parse(line));
            assert.equal(
                messages.some((message) => isRecord(message) && message.method === 'notifications/cancelled'),
                false,
            );
            await resource.close();
        } finally {
            await child.cleanup();
            controller.abort();
            await resource?.close().catch(() => {});
            await creating.catch(() => {});
        }
    });
}

test('pre-aborted official acquisition never spawns a child', async () => {
    const child = await fixture();
    const controller = new AbortController();
    controller.abort(new Error('Cancelled before verification'));
    let acquired = false;
    try {
        await assert.rejects(
            createOfficialConnection('http://127.0.0.1:9222', {
                ...child.options,
                signal: controller.signal,
                onAcquired: () => {
                    acquired = true;
                },
            }),
            /Cancelled before verification/,
        );
        assert.equal(acquired, false);
        await assert.rejects(readFile(path.join(child.directory, 'started.json')), { code: 'ENOENT' });
    } finally {
        await child.cleanup();
    }
});

test('failed owned child signalling retains exit observation and permits explicit cleanup retry', async () => {
    const child = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', child.options);
    let exits = 0;
    connection.onExit(() => exits++);
    const signalling = mock.method(ChildProcess.prototype, 'kill', () => false);
    try {
        await assert.rejects(connection.close(), /signal|SIGTERM/i);
        assert.equal(exits, 0);
        const evidence = await marker(child.directory, 'started');
        assert.equal(typeof evidence.pid, 'number');
        if (typeof evidence.pid !== 'number') throw new Error('Expected fixture PID.');
        assert.equal(alive(evidence.pid), true);
        signalling.mock.restore();
        await connection.close();
        assert.equal(exits, 1);
        assert.equal(alive(evidence.pid), false);
    } finally {
        signalling.mock.restore();
        await child.cleanup();
        await connection.close().catch(() => {});
    }
});

test('official close timeout retains the live child and only a later actual exit completes observation', async () => {
    const child = await fixture();
    const connection = await createOfficialConnection('http://127.0.0.1:9222', child.options);
    let exits = 0;
    let markExit: () => void = () => {};
    const exit = new Promise<void>((resolve) => {
        markExit = resolve;
    });
    connection.onExit(() => {
        exits++;
        markExit();
    });
    const signalling = mock.method(ChildProcess.prototype, 'kill', () => true);
    try {
        const began = performance.now();
        await within(
            assert.rejects(connection.close(), /exit.*10 seconds/i),
            10_700,
            'Close exceeded its total budget.',
        );
        assert.ok(performance.now() - began >= 9700);
        assert.equal(exits, 0);
        const evidence = await marker(child.directory, 'started');
        assert.equal(typeof evidence.pid, 'number');
        if (typeof evidence.pid !== 'number') throw new Error('Expected fixture PID.');
        assert.equal(alive(evidence.pid), true);
        signalling.mock.restore();
        process.kill(evidence.pid, 'SIGKILL');
        await within(exit, 1000, 'Timed-out resource lost its actual exit subscription.');
        assert.equal(exits, 1);
        await within(connection.close(), 400, 'Already exited resource was not retained.');
    } finally {
        signalling.mock.restore();
        await child.cleanup();
        await connection.close().catch(() => {});
    }
});

test('failed initialize keeps owned reaping errors separate from the SDK logical transport close', async () => {
    const child = await fixture('invalid-initialize');
    let resource: Resource | undefined;
    const signalling = mock.method(ChildProcess.prototype, 'kill', () => false);
    try {
        await assert.rejects(
            createOfficialConnection('http://127.0.0.1:9222', {
                ...child.options,
                onAcquired: (value: Resource) => {
                    resource = value;
                },
            }),
            /protocol version is not supported/,
        );
        assert.ok(resource);
        await assert.rejects(resource.close(), /SIGTERM/);
        signalling.mock.restore();
        await resource.close();
    } finally {
        signalling.mock.restore();
        await child.cleanup();
        await resource?.close().catch(() => {});
    }
});
