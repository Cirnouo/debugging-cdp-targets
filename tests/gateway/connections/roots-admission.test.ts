import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { Server } from '@modelcontextprotocol/server';
import { parseControlRequest } from '../../../src/domains/control-contract.ts';
import { isRecord } from '../../../src/shared/errors.ts';
import { boundedManagedResult, createManagedConnectionFixture } from '../../fixtures/gateway/core-runtime.ts';

for (const action of ['cancel', 'cleanup'] as const) {
    for (const late of ['resolve', 'reject'] as const) {
        test(`${action} stops pending roots admission and consumes late ${late} without acquisition`, async () => {
            const f = await createManagedConnectionFixture();
            const client = f.client('a');
            let resolveRoots: (value: { roots: { uri: string }[] }) => void = () => {};
            let rejectRoots: (reason: Error) => void = () => {};
            const roots = new Promise<{ roots: { uri: string }[] }>((resolve, reject) => {
                resolveRoots = resolve;
                rejectRoots = reject;
            });
            let cleaning: Promise<void> | undefined;
            try {
                const context = client.handle.request({
                    requestId: 0,
                    capabilities: { roots: true, formElicitation: false },
                    readRoots: () => roots,
                });
                const accepted = await f.core.control(
                    {
                        action: 'start',
                        requestId: 'pending-roots',
                        isolation: {
                            mode: 'data-dir',
                            directory: { kind: 'new', parent: path.dirname(process.execPath), name: 'never-acquired' },
                            cleanup: 'retain',
                        },
                        launch: { executable: process.execPath, args: ['--profile={dataDir}'] },
                    },
                    context,
                );
                await new Promise<void>((resolve) => setImmediate(resolve));
                if (action === 'cancel') {
                    await f.core.control(
                        { action: 'cancel', operationId: String(accepted.operationId) },
                        client.context(),
                    );
                    await new Promise<void>((resolve) => setImmediate(resolve));
                    const terminal = await boundedManagedResult(
                        f.core.control({ action: 'wait', operationId: String(accepted.operationId) }, client.context()),
                        'Roots cancellation did not settle.',
                    );
                    assert.equal(terminal.complete, true);
                }
                cleaning = f.core.cleanup();
                await boundedManagedResult(cleaning, 'Roots admission held final cleanup.');
                assert.equal(f.core.admin.cleanupState(), 'closed');
                if (late === 'resolve') resolveRoots({ roots: [{ uri: 'file:///late' }] });
                else rejectRoots(new Error('Late ignored roots failure.'));
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.deepEqual(f.counts(), { launched: 0, closed: 0 });
                assert.deepEqual(f.generations(), { officialCreated: 1, officialClosed: 1, routersCreated: 1 });
                assert.equal(f.directoryAcquisitions(), 0);
            } finally {
                resolveRoots({ roots: [] });
                await cleaning;
                await f.core.cleanup();
            }
        });
    }
}

for (const action of ['cancel', 'cleanup'] as const) {
    test(`actual SDK reverse roots receives ${action} and final cleanup owns no late resources`, async () => {
        const f = await createManagedConnectionFixture();
        const [clientTransport, entryTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'roots-boundary', version: '1' }, { capabilities: { roots: {} } });
        const registration = f.core.register();
        const attached = f.core.attachClient(registration.bearer);
        const entry = new Server({ name: 'test-reverse-roots', version: '1' }, { capabilities: { tools: {} } });
        entry.setRequestHandler('tools/call', async (request, context) => {
            const action = request.params.name === 'dct_connection_start' ? 'start' : 'cancel';
            const clientContext = attached.request({
                requestId: context.mcpReq.id,
                capabilities: { roots: true, formElicitation: false },
                waitSignal: context.mcpReq.signal,
                readRoots: (signal) => context.mcpReq.send({ method: 'roots/list' }, signal ? { signal } : {}),
            });
            const result = await f.core.control(
                parseControlRequest({ ...request.params.arguments, action }),
                clientContext,
            );
            return { content: [], structuredContent: result };
        });
        let rootsSignal: AbortSignal | undefined;
        let entered = () => {};
        let release = () => {};
        const began = new Promise<void>((resolve) => {
            entered = resolve;
        });
        client.setRequestHandler('roots/list', async (_request, ctx) => {
            rootsSignal = ctx.mcpReq.signal;
            entered();
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return { roots: [{ uri: 'file:///original-sdk-client' }] };
        });
        let cleaning: Promise<void> | undefined;
        try {
            await entry.connect(entryTransport);
            await client.connect(clientTransport);
            const started = await client.callTool({
                name: 'dct_connection_start',
                arguments: {
                    requestId: 'sdk-roots',
                    isolation: {
                        mode: 'data-dir',
                        directory: { kind: 'new', parent: path.dirname(process.execPath), name: 'never-acquired' },
                        cleanup: 'retain',
                    },
                    launch: { executable: process.execPath, args: ['--profile={dataDir}'] },
                },
            });
            await boundedManagedResult(began, 'SDK roots request did not enter.');
            assert.ok(isRecord(started.structuredContent));
            const operationId = started.structuredContent.operationId;
            if (action === 'cancel') {
                await client.callTool({
                    name: 'dct_operation_cancel',
                    arguments: { operationId },
                });
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.equal(
                    rootsSignal?.aborted,
                    true,
                    'Explicit operation cancellation reaches the SDK before cleanup.',
                );
                assert.equal(
                    f.core.admin.operations().find((operation) => operation.operationId === operationId)?.state,
                    'cancelled',
                );
            }
            cleaning = f.core.cleanup();
            await boundedManagedResult(cleaning, 'SDK reverse roots held final cleanup.');
            assert.equal(rootsSignal?.aborted, true);
            release();
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.deepEqual(f.counts(), { launched: 0, closed: 0 });
            assert.deepEqual(f.generations(), { officialCreated: 1, officialClosed: 1, routersCreated: 1 });
            assert.equal(f.directoryAcquisitions(), 0);
        } finally {
            release();
            await cleaning;
            await f.core.cleanup();
            await entry.close();
            await client.close();
        }
    });
}

test('negotiated roots failure precedes all connection acquisitions while unsupported roots are empty', async () => {
    const f = await createManagedConnectionFixture();
    const registration = f.core.register();
    const client = f.core.attachClient(registration.bearer);
    try {
        const failed = client.request({
            requestId: 0,
            capabilities: { roots: true, formElicitation: false },
            readRoots: async () => {
                throw new Error('Roots unavailable.');
            },
        });
        await assert.rejects(
            f.core.controller.start(
                { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
                { client: failed },
            ),
            /Roots unavailable/,
        );
        assert.deepEqual(f.counts(), { launched: 0, closed: 0 });
        assert.equal(f.generations().routersCreated, 1);
        const unsupported = client.request({
            requestId: 1,
            capabilities: { roots: false, formElicitation: false },
            readRoots: async () => {
                throw new Error('Must not request unnegotiated roots.');
            },
        });
        const connection = await f.core.controller.start(
            { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
            { client: unsupported },
        );
        const result = await f.core.invoke(
            'echo',
            { _dct: { connectionId: connection.connectionId, sessionId: connection.sessionId } },
            unsupported,
        );
        assert.deepEqual(result.structuredContent, { roots: { roots: [] } });
    } finally {
        await f.core.cleanup();
    }
});

test('workspace configuration retains the pre-roots temporary snapshot and returns private independent copies', async (t) => {
    const f = await createManagedConnectionFixture();
    const a = f.client('workspace-owner');
    let temporaryDirectory = '/policy-before-roots';
    const temporary = t.mock.method(os, 'tmpdir', () => temporaryDirectory);
    let resolveRoots: (value: { roots: { uri: string }[] }) => void = () => {};
    const roots = new Promise<{ roots: { uri: string }[] }>((resolve) => {
        resolveRoots = resolve;
    });
    let entered = () => {};
    const reading = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const context = a.handle.request({
        requestId: 0,
        capabilities: { roots: true, formElicitation: false },
        readRoots: () => {
            entered();
            return roots;
        },
    });
    const starting = f.core.controller.start(
        { isolation: { mode: 'none' }, launch: { executable: 'fixture' } },
        { client: context },
    );
    try {
        await boundedManagedResult(reading, 'Workspace roots request did not enter.');
        temporaryDirectory = '/policy-after-roots';
        resolveRoots({ roots: [{ uri: 'file:///policy-original-root' }] });
        const connection = await starting;
        const request = {
            action: 'status' as const,
            connectionId: connection.connectionId,
            include: ['configuration' as const],
        };
        const selected = await f.core.control(request, context);
        assert.deepEqual(selected.workspace, {
            officialDirectories: ['/policy-before-roots'],
            officialSource: 'system-temporary-directory',
            clientRoots: 'immutable-start-snapshot',
            unrestrictedPaths: false,
            cwdGrantsAccess: false,
        });
        assert.deepEqual(selected.roots, { roots: [{ uri: 'file:///policy-original-root' }] });
        for (const summary of [
            await f.core.control({ action: 'status' }, context),
            await f.core.control({ action: 'status', connectionId: connection.connectionId }, context),
        ]) {
            assert.equal(Object.hasOwn(summary, 'workspace'), false);
            assert.equal(Object.hasOwn(summary, 'roots'), false);
            assert.doesNotMatch(JSON.stringify(summary), /policy-before-roots|policy-after-roots|policy-original-root/);
        }
        assert.ok(isRecord(selected.workspace) && Array.isArray(selected.workspace.officialDirectories));
        selected.workspace.officialDirectories[0] = '/caller-mutated-workspace';
        assert.ok(isRecord(selected.roots) && Array.isArray(selected.roots.roots));
        assert.ok(isRecord(selected.roots.roots[0]));
        selected.roots.roots[0].uri = 'file:///caller-mutated-root';
        const reread = await f.core.control(request, context);
        assert.deepEqual(reread.workspace, {
            officialDirectories: ['/policy-before-roots'],
            officialSource: 'system-temporary-directory',
            clientRoots: 'immutable-start-snapshot',
            unrestrictedPaths: false,
            cwdGrantsAccess: false,
        });
        assert.deepEqual(reread.roots, { roots: [{ uri: 'file:///policy-original-root' }] });
    } finally {
        resolveRoots({ roots: [] });
        try {
            await starting;
        } finally {
            try {
                await f.core.cleanup();
            } finally {
                temporary.mock.restore();
            }
        }
    }
});
