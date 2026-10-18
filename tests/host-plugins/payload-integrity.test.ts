import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    overlayPluginEndpoint,
    pluginMcpEndpointEvidence,
    verifyPluginPayload,
} from '../../src/host-plugins/payload-integrity.ts';

test('real payload overlay imports and runs without filesystem, process or network dependencies', async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-pure-payload-')));
    try {
        const moduleUrl = new URL('../../src/host-plugins/payload-integrity.ts', import.meta.url).href;
        const result = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                String.raw`
            import assert from 'node:assert/strict';
            import { registerHooks } from 'node:module';
            const forbidden = /^(?:node:)?(?:fs(?:\/promises)?|crypto|child_process|http|https|http2|net|tls|dgram|dns(?:\/promises)?)$/;
            registerHooks({ resolve(specifier, context, nextResolve) {
                if (forbidden.test(specifier)) throw new Error('forbidden-payload-dependency:' + specifier);
                return nextResolve(specifier, context);
            } });
            const { overlayPluginEndpoint } = await import(${JSON.stringify(moduleUrl)});
            const bytes = Buffer.from('{"mcpServers":{"cdp-targets":{"type":"streamable-http","url":"http://localhost:27637/mcp"}},"intact":"字"}');
            assert.equal(overlayPluginEndpoint(bytes, 'codex', 'http://localhost:3333/mcp').toString(), '{"mcpServers":{"cdp-targets":{"type":"streamable-http","url":"http://localhost:3333/mcp"}},"intact":"字"}');
            const claude = Buffer.from('{"mcpServers":{"cdp-targets":{"type":"http","url":"http://localhost:27637/mcp"}}}');
            assert.equal(overlayPluginEndpoint(claude, 'claude', 'http://localhost:3333/mcp').toString(), '{"mcpServers":{"cdp-targets":{"type":"http","url":"http://localhost:3333/mcp"}}}');
        `,
            ],
            { cwd, encoding: 'utf8', windowsHide: true, timeout: 10000 },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
    } finally {
        await rm(cwd, { recursive: true });
    }
});

test('literal endpoint evidence preserves byte offsets, identity and own-key JSON semantics', () => {
    const bytes = Buffer.from(
        '{"前":"字","mcpServers":{"cdp-targets":{"type":"http","url":"http://localhost:27637/mcp"}},"tail":true}\n',
    );
    assert.deepEqual(pluginMcpEndpointEvidence(bytes, 'claude'), {
        endpoint: 'http://localhost:27637/mcp',
        byteOffset: Buffer.byteLength('{"前":"字","mcpServers":{"cdp-targets":{"type":"http","url":'),
    });
    assert.equal(overlayPluginEndpoint(bytes, 'claude', 'http://localhost:27637/mcp'), bytes);
    assert.equal(
        overlayPluginEndpoint(bytes, 'claude', 'http://localhost:3333/mcp').toString(),
        '{"前":"字","mcpServers":{"cdp-targets":{"type":"http","url":"http://localhost:3333/mcp"}},"tail":true}\n',
    );
    assert.throws(
        () => overlayPluginEndpoint(bytes, 'claude', 'http://localhost:3333/mcp', 0),
        /mismatched-payload-overlay/,
    );
    const duplicate = Buffer.from(
        '{"mcpServers":{"cdp-targets":{"type":"http","url":"http://localhost:27637/mcp","url":"http://localhost:27637/mcp"}}}',
    );
    assert.equal(
        overlayPluginEndpoint(duplicate, 'claude', 'http://localhost:3333/mcp').toString(),
        '{"mcpServers":{"cdp-targets":{"type":"http","url":"http://localhost:27637/mcp","url":"http://localhost:3333/mcp"}}}',
    );
    const escapedKey = Buffer.from(
        '{"mcpServers":{"cdp-targets":{"type":"http","u\\u0072l":"http://localhost:27637/mcp"}}}',
    );
    assert.equal(
        overlayPluginEndpoint(escapedKey, 'claude', 'http://localhost:3333/mcp').toString(),
        '{"mcpServers":{"cdp-targets":{"type":"http","u\\u0072l":"http://localhost:3333/mcp"}}}',
    );
    assert.throws(() => pluginMcpEndpointEvidence(Buffer.from([0xff]), 'codex'), /invalid-payload-json/);
});

function fixture() {
    const mcp = 'mcp.json';
    const files = new Map([
        ['.codex-plugin/plugin.json', Buffer.from('{"name":"debugging-cdp-targets","version":"0.2.0"}')],
        [
            mcp,
            Buffer.from(
                '{"mcpServers":{"cdp-targets":{"type":"streamable-http","url":"http://127.0.0.1:27637/mcp","headers":{"X-Fixture":"private-header"}},"unrelated":{"type":"http","url":"https://example.invalid"}},"extra":{"intact":true}}',
            ),
        ],
        ['README.md', Buffer.from('fixture\n')],
    ]);
    return { files, mcp };
}

test('MCP formatting drift is outside the one URL byte overlay', () => {
    const f = fixture();
    const drifted = new Map(f.files);
    const current = drifted.get(f.mcp);
    assert.ok(current);
    drifted.set(f.mcp, Buffer.from(`${current.toString('utf8')}\n`));
    assert.throws(() => verifyPluginPayload('codex', '0.2.0', f.files, drifted), /overlay/);
});

test('source layouts without a bounded unique canonical own URL literal fail before native installation', () => {
    const f = fixture();
    const original = f.files.get(f.mcp)?.toString('utf8');
    assert.ok(original);
    const escaped = new Map(f.files);
    escaped.set(f.mcp, Buffer.from(original.replace('http://127.0.0.1:27637/mcp', 'http:\\/\\/127.0.0.1:27637/mcp')));
    assert.throws(() => verifyPluginPayload('codex', '0.2.0', escaped, escaped, false), /payload-overlay/);
    const crowded = new Map(f.files);
    crowded.set(
        f.mcp,
        Buffer.from(
            original.replace(
                '"extra":',
                `"copies":${JSON.stringify(Array(65).fill('http://127.0.0.1:27637/mcp'))},"extra":`,
            ),
        ),
    );
    assert.throws(() => verifyPluginPayload('codex', '0.2.0', crowded, crowded, false), /payload-overlay/);
});
