import os from 'node:os';
import path from 'node:path';
import {
    JsonHostPluginReceiptStore,
    parseManagedPluginReceipt,
    receiptMatchesSelection,
} from '../adapters/managed-plugin-receipts.ts';
import { NativeHostPluginAdapter } from '../adapters/native-host-plugins.ts';
import type { AppConfiguration, AppHostSelection } from '../domains/app-configuration.ts';
import type { AppHostSummary, AppManagementCommand } from '../domains/app-ui.ts';
import type { PluginHost } from '../domains/host-management.ts';
import { HostPluginManager } from './host-plugin-manager.ts';

type Manager = Pick<HostPluginManager, 'inspect' | 'synchronize'>;
type Slot = { selection: AppHostSelection; manager?: Manager; pending?: Promise<void>; summary: AppHostSummary };
const HOSTS = ['codex', 'claude'] as const;

/** Cache native inspection separately from GUI polling; each host owns its actual pending CLI chain. */
export function createAppHostManagement(options: {
    dataRoot: string;
    appVersion: string;
    hosts: AppConfiguration['hosts'];
    endpoint: () => string | undefined;
    createManager?: (host: PluginHost, selection: AppHostSelection) => Manager;
}) {
    let closing = false;
    const slots = new Map<PluginHost, Slot>(
        HOSTS.map((host) => [
            host,
            { selection: options.hosts[host], summary: { host, state: 'not-checked', activation: 'unverified' } },
        ]),
    );
    const store = new JsonHostPluginReceiptStore(options.dataRoot);
    const environment = Object.freeze({ ...process.env });
    const home = os.homedir();
    function createManager(host: PluginHost, override: AppHostSelection): Manager {
        if (options.createManager) return options.createManager(host, override);
        const pluginRoot =
            override.pluginRoot ?? (host === 'claude' ? environment.CLAUDE_CODE_PLUGIN_CACHE_DIR : undefined);
        const selection = {
            host,
            configRoot:
                override.configRoot ??
                (host === 'codex' ? environment.CODEX_HOME : environment.CLAUDE_CONFIG_DIR) ??
                path.join(home, host === 'codex' ? '.codex' : '.claude'),
            neutralCwd: home,
            marketplaceSource: 'https://github.com/Cirnouo/debugging-cdp-targets.git',
            environment,
            ...(override.executable === null ? {} : { executable: override.executable }),
            ...(pluginRoot === undefined ? {} : { pluginRoot }),
        };
        return new HostPluginManager({
            appVersion: options.appVersion,
            adapters: [new NativeHostPluginAdapter(selection)],
            receiptStore: {
                async read(selected) {
                    const value = await store.read(selected);
                    if (value === undefined) return undefined;
                    // Another explicitly selected root is a new management boundary, never an adopted copy.
                    return receiptMatchesSelection(parseManagedPluginReceipt(value), selection) ? value : undefined;
                },
                write: (selected, receipt) => store.write(selected, receipt),
            },
        });
    }
    function selected(host: PluginHost): Slot {
        const slot = slots.get(host);
        if (!slot) throw new Error('Invalid host selection.');
        return slot;
    }
    function snapshot(): AppHostSummary[] {
        return HOSTS.map((host) => {
            const slot = selected(host);
            return structuredClone(slot.pending ? { ...slot.summary, state: 'busy' as const } : slot.summary);
        });
    }
    async function run(command: Extract<AppManagementCommand, { host: PluginHost }>): Promise<void> {
        if (closing) throw new Error('Host management is closing.');
        const slot = selected(command.host);
        if (slot.pending) throw new Error('Host management is busy.');
        const endpoint = options.endpoint();
        if (command.kind === 'host-sync' && endpoint === undefined)
            throw new Error('A successfully bound App endpoint is required.');
        slot.manager ??= createManager(command.host, slot.selection);
        const manager = slot.manager;
        const job = (async () => {
            const inspected = (await manager.inspect(command.host))[0];
            if (!inspected) throw new Error('Host inspection returned no state.');
            if (command.kind === 'host-inspect') {
                slot.summary = inspected;
                return;
            }
            const result = (await manager.synchronize(null, endpoint ?? '', command.host))[0];
            if (!result) throw new Error('Host synchronization returned no state.');
            // No published candidate is ordinary; retain the independently inspected native condition.
            slot.summary =
                result.state === 'no-candidate' && (inspected.state === 'failed' || inspected.state === 'read-only')
                    ? { ...inspected, candidate: 'no-candidate' }
                    : {
                          ...result,
                          ...(result.installations === undefined && inspected.installations !== undefined
                              ? { installations: inspected.installations }
                              : {}),
                      };
        })();
        slot.pending = job;
        try {
            await job;
        } catch {
            slot.summary = {
                host: command.host,
                state: 'failed',
                activation: 'unverified',
                reason: 'verification-failed',
            };
        } finally {
            delete slot.pending;
        }
    }
    function assertConfigurable(hosts: AppConfiguration['hosts']) {
        if (closing) throw new Error('Host management is closing.');
        for (const host of HOSTS)
            if (JSON.stringify(hosts[host]) !== JSON.stringify(selected(host).selection) && selected(host).pending)
                throw new Error('Host selection is busy. Wait for native work before changing it.');
    }
    function configure(hosts: AppConfiguration['hosts']) {
        assertConfigurable(hosts);
        for (const host of HOSTS) {
            const slot = selected(host);
            if (JSON.stringify(hosts[host]) !== JSON.stringify(slot.selection)) {
                slot.selection = hosts[host];
                delete slot.manager;
                slot.summary = { host, state: 'not-checked', activation: 'unverified' };
            }
        }
    }
    async function close() {
        closing = true;
        await Promise.all(HOSTS.map((host) => selected(host).pending));
    }
    return { snapshot, run, assertConfigurable, configure, close };
}
