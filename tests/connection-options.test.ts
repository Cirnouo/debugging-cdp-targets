import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Tool } from '@modelcontextprotocol/client';
import { createToolCatalog } from '../src/adapters/tool-catalog.ts';
import { isRecord } from '../src/shared/errors.ts';
import { createCoreFixture } from './fixtures/core-runtime.ts';

test('connections keep independent actual catalogs and explicit restart invalidates only its old session', async () => {
    const routed: Tool = {
        name: 'evaluate_script',
        inputSchema: {
            type: 'object',
            properties: { function: { type: 'string' }, pageId: { type: 'number' } },
            required: ['function', 'pageId'],
        },
    };
    const unrouted: Tool = {
        ...routed,
        inputSchema: { type: 'object', properties: { function: { type: 'string' } }, required: ['function'] },
    };
    const slim: Tool = {
        name: 'evaluate',
        inputSchema: { type: 'object', properties: { function: { type: 'string' } }, required: ['function'] },
    };
    const catalog = createToolCatalog({
        version: '1.11.0',
        tools: [
            { name: routed.name, requires: { slim: false }, variants: [routed, unrouted] },
            { name: slim.name, requires: { slim: true }, variants: [slim] },
        ],
    });

    const calls: { url: string; name: string; args: Record<string, unknown> }[] = [];
    let routers = 0;
    let launched = 0;
    const children = new Map<number, EventEmitter>();
    const runtime = await createCoreFixture({
        loadCatalog: async () => catalog,
        createRouter: async () => ({
            url: `http://127.0.0.1:${30000 + routers++}`,
            isBusy: () => false,
            setTarget: () => {},
            clearTarget: () => {},
            close: async () => {},
        }),
        createHost: () => ({
            launch: async () => {
                const child = new EventEmitter();
                children.set(++launched, child);
                return {
                    processId: launched,
                    port: 9222 + launched,
                    executablePath: process.execPath,
                    startedAtUtc: '2026-10-04T00:00:00Z',
                    targetKind: 'generic-cdp',
                    child,
                    launchDefinition: { executablePath: process.execPath, arguments: [] },
                };
            },
            close: async (target) => {
                children.get(target.processId)?.emit('exit');
                return true;
            },
        }),
        createConnection: async (url, options) => ({
            tools: options?.args?.includes('--slim')
                ? [slim]
                : [options?.args?.includes('--pageIdRouting=false') ? unrouted : routed],
            call: async (name, args) => {
                calls.push({ url, name, args });
                return { content: [{ type: 'text', text: 'unchanged' }], isError: false };
            },
            close: async () => {},
            rootsChanged: async () => {},
            onExit: () => {},
        }),
    });
    assert.ok(runtime?.control);
    const gateway = runtime;
    const control = runtime.control;
    try {
        const preflight = await control({ action: 'status', toolNames: ['evaluate'] });
        assert.match(JSON.stringify(preflight), /slim=true/);
        assert.equal(JSON.stringify(preflight).includes('suggestedMcpArgs'), false);
        const first = await runtime.controller.start({
            isolation: { mode: 'none' },
            launch: { executable: 'fixture' },
        });
        const second = await runtime.controller.start({
            isolation: { mode: 'none' },
            launch: { executable: 'fixture' },
            mcpArgs: ['--slim'],
        });
        const firstStatus = await control({
            action: 'status',
            connectionId: first.connectionId,
        });
        const secondStatus = await control({
            action: 'status',
            connectionId: second.connectionId,
        });
        assert.deepEqual(firstStatus.enabledTools, ['evaluate_script']);
        assert.deepEqual(secondStatus.enabledTools, ['evaluate']);
        const signal = new AbortController().signal;
        const args = { _dct: { connectionId: second.connectionId, sessionId: second.sessionId }, function: '() => 1' };
        const before = structuredClone(args);
        const unavailable = await gateway.invoke('evaluate_script', args, signal, () => {});
        assert.ok(isRecord(unavailable.structuredContent));
        assert.equal(unavailable.structuredContent.code, 'TOOL_NOT_ENABLED');
        assert.ok(JSON.stringify(unavailable).includes('--slim=false'));
        assert.equal(launched, 2);
        assert.equal(calls.length, 0);
        const result = await gateway.invoke('evaluate', args, signal, () => {});
        assert.deepEqual(result, { content: [{ type: 'text', text: 'unchanged' }], isError: false });
        assert.deepEqual(args, before);
        assert.deepEqual(calls[0]?.args, { function: '() => 1' });
        assert.ok(first.sessionId);
        const restarted = await runtime.controller.restart({
            connectionId: first.connectionId,
            sessionId: first.sessionId,
            scope: 'both',
        });
        assert.equal(restarted.connectionId, first.connectionId);
        assert.notEqual(restarted.sessionId, first.sessionId);
        const actual = await control({
            action: 'status',
            connectionId: first.connectionId,
            toolNames: ['evaluate_script'],
        });
        assert.ok(JSON.stringify(actual).includes('"pageId"'));
        await assert.rejects(
            gateway.invoke(
                'evaluate_script',
                {
                    _dct: { connectionId: first.connectionId, sessionId: first.sessionId },
                    function: '() => 1',
                    pageId: 1,
                },
                signal,
                () => {},
            ),
            /stale/,
        );
        await gateway.invoke('evaluate', args, signal, () => {});
        const invalidReplacement = {
            connectionId: restarted.connectionId,
            sessionId: restarted.sessionId ?? '',
            scope: 'both' as const,
            mcpArgs: ['--browser-url=http://other'],
        };
        await assert.rejects(runtime.controller.restart(invalidReplacement), /cannot replace mcpArgs/);
        const retained = runtime.controller.status(first.connectionId);
        assert.ok('status' in retained);
        assert.equal(retained.status, 'active');
    } finally {
        await runtime.cleanup();
    }
});
