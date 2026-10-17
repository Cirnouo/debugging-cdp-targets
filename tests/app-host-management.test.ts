import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppHostManagement } from '../src/application/app-host-management.ts';
import { HostPluginManager } from '../src/application/host-plugin-manager.ts';
import { defaultAppConfiguration } from '../src/domains/app-configuration.ts';
import type { PluginHost } from '../src/domains/host-management.ts';

test('host management caches independent native results, retries one peer and settles native work before closing', async () => {
    let release: (() => void) | undefined;
    let signal: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
        signal = resolve;
    });
    const calls = { codex: 0, claude: 0 };
    let fail = true;
    let block = false;
    const hosts = createAppHostManagement({
        dataRoot: '/fixture-data',
        appVersion: '0.1.0',
        hosts: defaultAppConfiguration().hosts,
        endpoint: () => 'http://127.0.0.1:28761/mcp',
        createManager: (host: PluginHost) =>
            new HostPluginManager({
                appVersion: '0.1.0',
                adapters: [
                    {
                        selection: { host, marketplaceSource: 'https://example.invalid/plugins.git' },
                        inspect: async () => {
                            calls[host]++;
                            if (host === 'claude' && fail) throw new Error('cli-missing');
                            if (block) {
                                signal?.();
                                await new Promise<void>((resolve) => {
                                    release = resolve;
                                });
                            }
                            return { host, cliVersion: '1.0.0', installations: [] };
                        },
                        refreshMarketplace: async () => {},
                        installOrUpdate: async () => {},
                    },
                ],
            }),
    });
    await Promise.all((['codex', 'claude'] as const).map((host) => hosts.run({ kind: 'host-sync', host })));
    assert.deepEqual(
        hosts.snapshot().map((item) => [item.host, item.state]),
        [
            ['codex', 'no-candidate'],
            ['claude', 'failed'],
        ],
    );
    for (let tick = 0; tick < 20; tick++) hosts.snapshot();
    assert.deepEqual(calls, { codex: 1, claude: 1 });
    fail = false;
    await hosts.run({ kind: 'host-sync', host: 'claude' });
    assert.deepEqual(calls, { codex: 1, claude: 2 });
    block = true;
    const pending = hosts.run({ kind: 'host-inspect', host: 'codex' });
    await entered;
    const changed = {
        ...defaultAppConfiguration().hosts,
        codex: { configRoot: '/different-root', executable: null, pluginRoot: null },
    };
    assert.throws(() => hosts.assertConfigurable(changed), /busy/);
    let closed = false;
    const closing = hosts.close().then(() => {
        closed = true;
    });
    await Promise.resolve();
    assert.equal(closed, false);
    await assert.rejects(hosts.run({ kind: 'host-sync', host: 'claude' }), /closing/);
    release?.();
    await pending;
    await closing;
    assert.equal(closed, true);
});
