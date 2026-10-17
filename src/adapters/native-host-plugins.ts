import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs';
import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    OWN_PLUGIN,
    OWN_PLUGIN_ID,
    type PluginHost,
    pluginSourcePath,
    type StablePluginRecord,
} from '../domains/host-management.ts';
import { isSemVer } from '../domains/software-version.ts';
import { isRecord } from '../shared/errors.ts';
import { readRegularFile } from './file-evidence.ts';
import { assertNativeIntentTransition, readHostUserIntent } from './host-user-intent.ts';
import type { NativeManagedReceipt } from './managed-plugin-receipts.ts';
import { assertClaudePluginUnused, canonicalPluginRoot } from './verified-plugin-files.ts';

export interface HostSelection {
    host: PluginHost;
    executable?: string;
    configRoot: string;
    neutralCwd: string;
    marketplaceSource: string;
    pluginRoot?: string;
    environment: Readonly<Record<string, string | undefined>>;
}

export interface NativeCommand {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    windowsHide: true;
    timeoutMs: number;
    maxOutputBytes: number;
}

export interface NativeCommandResult {
    exitCode: number | null;
    stdout: string;
    timedOut?: boolean;
    overflow?: boolean;
}

export interface HostInstallation {
    version: string;
    enabled: boolean;
    scope: string;
    root?: string;
    readOnlyReason?: string;
}

export interface HostInventory {
    host: PluginHost;
    cliVersion: string;
    installations: HostInstallation[];
    marketplace?: { root: string; source: string; readOnlyReason?: string };
    catalog?: Record<string, unknown>;
    readOnlyReason?: string;
}

export async function runNativeCommand(command: NativeCommand): Promise<NativeCommandResult> {
    return new Promise((resolve) => {
        execFile(
            command.executable,
            command.args,
            {
                cwd: command.cwd,
                env: command.env,
                windowsHide: true,
                shell: false,
                encoding: 'utf8',
                timeout: command.timeoutMs,
                maxBuffer: command.maxOutputBytes,
            },
            (error, stdout) => {
                if (!error) resolve({ exitCode: 0, stdout });
                else
                    resolve({
                        exitCode: typeof error.code === 'number' ? error.code : null,
                        stdout,
                        timedOut: error.killed === true,
                        overflow: error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                    });
            },
        );
    });
}

async function resolveHostExecutable(selection: HostSelection): Promise<string | undefined> {
    const names = process.platform === 'win32' ? [`${selection.host}.exe`] : [selection.host];
    const pathEntries = Object.entries(selection.environment).filter(([key]) =>
        process.platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH',
    );
    if (pathEntries.length > 1 && !selection.executable) return undefined;
    const candidates = selection.executable
        ? [selection.executable]
        : (pathEntries[0]?.[1] ?? '')
              .split(path.delimiter)
              .filter(Boolean)
              .flatMap((directory) => names.map((name) => path.join(directory, name)));
    for (const candidate of candidates) {
        if (
            !path.isAbsolute(candidate) ||
            (process.platform === 'win32' && path.extname(candidate).toLowerCase() !== '.exe')
        )
            continue;
        try {
            if (!(await stat(candidate)).isFile()) continue;
            await promisify(access)(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
            return candidate;
        } catch {
            /* Only inspect the explicitly selected executable or bounded PATH names. */
        }
    }
    return undefined;
}

function parseJson(text: string, finalLine = false): unknown {
    try {
        const input = finalLine ? text.trim().split(/\r?\n/).at(-1) : text;
        if (!input) throw new Error();
        return JSON.parse(input);
    } catch {
        throw new Error('invalid-native-output');
    }
}

function requiredString(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 8192 || value.includes('\0'))
        throw new Error('invalid-native-output');
    return value;
}

function requiredVersion(value: unknown): string {
    if (!isSemVer(value)) throw new Error('invalid-native-output');
    return value;
}

export function verifyCatalog(record: StablePluginRecord, host: PluginHost, catalog: Record<string, unknown>) {
    if (catalog.name !== OWN_PLUGIN || !Array.isArray(catalog.plugins)) throw new Error('invalid-marketplace-catalog');
    const own = catalog.plugins.filter((entry: unknown) => isRecord(entry) && entry.name === OWN_PLUGIN);
    if (own.length !== 1 || !isRecord(own[0]) || !isRecord(own[0].source))
        throw new Error('invalid-marketplace-catalog');
    const source = own[0].source;
    if (
        source.source !== 'git-subdir' ||
        source.url !== record.source.url ||
        source.sha !== record.source.sha ||
        (source.path !== pluginSourcePath(host) && source.path !== `./${pluginSourcePath(host)}`) ||
        (Object.hasOwn(own[0], 'version') && own[0].version !== record.version)
    )
        throw new Error('marketplace-source-moved');
}

/** One own plugin, two concrete native command contracts; no generic providers or cache-path guesses. */
export class NativeHostPluginAdapter {
    readonly selection: HostSelection;
    readonly io: { run: typeof runNativeCommand; resolveExecutable: typeof resolveHostExecutable };
    private receipt: { root: string; version: string } | undefined;
    private configReceipt: string | undefined;

    constructor(
        selection: HostSelection,
        io: { run?: typeof runNativeCommand; resolveExecutable?: typeof resolveHostExecutable } = {},
    ) {
        this.selection = Object.freeze({ ...selection, environment: Object.freeze({ ...selection.environment }) });
        this.io = { run: io.run ?? runNativeCommand, resolveExecutable: io.resolveExecutable ?? resolveHostExecutable };
    }

    private async command(args: string[], finalLine = false): Promise<unknown> {
        const selection = this.selection;
        if (
            !path.isAbsolute(selection.configRoot) ||
            !path.isAbsolute(selection.neutralCwd) ||
            (selection.pluginRoot !== undefined && !path.isAbsolute(selection.pluginRoot))
        )
            throw new Error('invalid-host-selection');
        if (!(await stat(selection.configRoot)).isDirectory() || !(await stat(selection.neutralCwd)).isDirectory())
            throw new Error('invalid-host-selection');
        const executable = await this.io.resolveExecutable(selection);
        if (!executable) throw new Error('cli-missing');
        const env = {
            ...selection.environment,
            ...(selection.host === 'codex'
                ? { CODEX_HOME: selection.configRoot }
                : { CLAUDE_CONFIG_DIR: selection.configRoot }),
            ...(selection.host === 'claude' && selection.pluginRoot
                ? { CLAUDE_CODE_PLUGIN_CACHE_DIR: selection.pluginRoot }
                : {}),
        };
        const result = await this.io.run({
            executable,
            args,
            cwd: selection.neutralCwd,
            env,
            windowsHide: true,
            timeoutMs: 60_000,
            maxOutputBytes: 256 * 1024,
        });
        if (result.timedOut) throw new Error('native-command-timeout');
        if (result.overflow || Buffer.byteLength(result.stdout) > 256 * 1024)
            throw new Error('native-output-too-large');
        if (result.exitCode !== 0) throw new Error('native-command-failed');
        if (args[0] === '--version') return result.stdout.trim();
        return parseJson(result.stdout, finalLine);
    }

    private async selectedConfiguration(): Promise<string> {
        return (await readHostUserIntent(this.selection.host, this.selection.configRoot)).snapshot;
    }

    async inspect(): Promise<HostInventory> {
        const host = this.selection.host;
        const versionOutput = await this.command(['--version']);
        const match =
            typeof versionOutput === 'string'
                ? host === 'codex'
                    ? /^codex-cli (\S+)$/.exec(versionOutput)
                    : /^(\S+) \(Claude Code\)$/.exec(versionOutput)
                : null;
        const cliVersion = requiredVersion(match?.[1]);
        const userIntent = await readHostUserIntent(host, this.selection.configRoot);
        const marketOutput = await this.command(['plugin', 'marketplace', 'list', '--json']);
        const markets = host === 'codex' && isRecord(marketOutput) ? marketOutput.marketplaces : marketOutput;
        if (!Array.isArray(markets)) throw new Error('invalid-native-output');
        const selected = markets.filter((entry: unknown) => isRecord(entry) && entry.name === OWN_PLUGIN);
        if (selected.length > 1) throw new Error('ambiguous-marketplace');
        const inventory: HostInventory = { host, cliVersion, installations: [] };
        const market = selected[0];
        if (isRecord(market)) {
            const root = requiredString(host === 'codex' ? market.root : market.installLocation);
            const source =
                host === 'codex' && isRecord(market.marketplaceSource) ? market.marketplaceSource.source : market.url;
            const git =
                host === 'codex'
                    ? isRecord(market.marketplaceSource) && market.marketplaceSource.sourceType === 'git'
                    : market.source === 'git';
            inventory.marketplace = {
                root,
                source: typeof source === 'string' ? source : '',
                ...(!git ||
                source !== this.selection.marketplaceSource ||
                market.ref !== undefined ||
                market.sha !== undefined
                    ? { readOnlyReason: 'marketplace-source-or-pin' }
                    : {}),
            };
            if (host === 'codex' && !inventory.marketplace.readOnlyReason) {
                if (!this.configReceipt) inventory.marketplace.readOnlyReason = 'marketplace-unresolved';
                else if ((await this.selectedConfiguration()) !== this.configReceipt)
                    inventory.marketplace.readOnlyReason = 'configuration-changed';
            }
            if (this.configReceipt && userIntent.snapshot !== this.configReceipt)
                inventory.marketplace.readOnlyReason = 'configuration-changed';
            if (userIntent.readOnlyReason) inventory.marketplace.readOnlyReason = userIntent.readOnlyReason;
            if (!userIntent.marketplace && host === 'claude')
                inventory.marketplace.readOnlyReason = 'marketplace-unresolved';
            const catalogPath =
                host === 'codex' ? '.agents/plugins/marketplace.json' : '.claude-plugin/marketplace.json';
            await canonicalPluginRoot(root);
            const catalog: unknown = JSON.parse((await readRegularFile(path.join(root, catalogPath))).toString('utf8'));
            if (!isRecord(catalog) || catalog.name !== OWN_PLUGIN || !Array.isArray(catalog.plugins))
                throw new Error('invalid-marketplace-catalog');
            inventory.catalog = catalog;
            if (
                host === 'codex' &&
                catalog.plugins.some((entry: unknown) => !isRecord(entry) || entry.name !== OWN_PLUGIN)
            )
                inventory.readOnlyReason = 'unrelated-marketplace-entries';
        }
        const output = await this.command(
            host === 'codex' ? ['plugin', 'list', '--marketplace', OWN_PLUGIN, '--json'] : ['plugin', 'list', '--json'],
        );
        const rows = host === 'codex' && isRecord(output) ? output.installed : output;
        if (!Array.isArray(rows) || (host === 'codex' && (!isRecord(output) || !Array.isArray(output.available))))
            throw new Error('invalid-native-output');
        const userDisabled = userIntent.pluginEnabled === false;
        if (userDisabled) inventory.readOnlyReason = 'disabled';
        for (const row of rows) {
            if (!isRecord(row)) throw new Error('invalid-native-output');
            const id = host === 'codex' ? row.pluginId : row.id;
            if (id !== OWN_PLUGIN_ID) {
                if (host === 'codex') inventory.readOnlyReason = 'unrelated-marketplace-entries';
                continue;
            }
            if (typeof row.enabled !== 'boolean') throw new Error('invalid-native-output');
            const installation: HostInstallation = {
                version: requiredVersion(row.version),
                enabled: row.enabled && !userDisabled,
                scope:
                    host === 'codex'
                        ? 'unknown'
                        : ['user', 'project', 'local', 'managed', 'synced', 'session', 'skills-directory'].includes(
                                requiredString(row.scope),
                            )
                          ? requiredString(row.scope)
                          : 'unknown',
            };
            if (!installation.enabled) installation.readOnlyReason = 'disabled';
            else if (
                row.pinned !== undefined ||
                row.pin !== undefined ||
                row.ref !== undefined ||
                row.sha !== undefined
            )
                installation.readOnlyReason = 'pinned-or-ambiguous';
            else if (host === 'codex') {
                if (!this.receipt || this.receipt.version !== row.version)
                    installation.readOnlyReason = 'existing-unresolved';
                else {
                    installation.root = await canonicalPluginRoot(this.receipt.root);
                    installation.scope = 'user';
                }
            } else if (row.readFromFolder !== undefined) {
                installation.readOnlyReason = 'in-place-installation';
            } else if (row.scope !== 'user') installation.readOnlyReason = 'read-only-scope';
            else installation.root = requiredString(row.installPath);
            // All own roots are needed for physical sharing checks, including read-only scopes.
            if (host === 'claude' && typeof row.installPath === 'string' && !installation.readOnlyReason)
                installation.root = await canonicalPluginRoot(row.installPath);
            if (host === 'claude' && installation.root && !installation.readOnlyReason) {
                try {
                    await assertClaudePluginUnused(installation.root);
                } catch {
                    installation.readOnlyReason = 'plugin-in-use';
                }
            }
            inventory.installations.push(installation);
        }
        if (host === 'claude') {
            const usersByPhysicalRoot = new Map<string, Set<number>>();
            const identityKey = async (root: string) => {
                const identity = await lstat(root, { bigint: true });
                return `${identity.dev}:${identity.ino}`;
            };
            for (const [index, row] of rows.entries()) {
                if (!isRecord(row) || row.id !== OWN_PLUGIN_ID) continue;
                for (const candidate of new Set([
                    row.installPath,
                    ...(row.readFromFolder === undefined ? [] : [row.readFromFolder]),
                ])) {
                    if (typeof candidate !== 'string') throw new Error('invalid-native-output');
                    // Both advertised cache and actual in-place roots can be shared; never drop the former.
                    try {
                        const root = await canonicalPluginRoot(candidate);
                        const key = await identityKey(root);
                        const users = usersByPhysicalRoot.get(key) ?? new Set<number>();
                        users.add(index);
                        usersByPhysicalRoot.set(key, users);
                    } catch {
                        inventory.readOnlyReason = 'unresolved-installation-root';
                    }
                }
            }
            for (const item of inventory.installations) {
                if (item.root && (usersByPhysicalRoot.get(await identityKey(item.root))?.size ?? 0) > 1)
                    item.readOnlyReason = 'shared-installation';
            }
        }
        if (inventory.installations.filter((item) => item.scope === 'user' || host === 'codex').length > 1)
            inventory.readOnlyReason = 'ambiguous-installations';
        return inventory;
    }

    async refreshMarketplace(absent: boolean): Promise<void> {
        const host = this.selection.host;
        const beforeIntent = await readHostUserIntent(host, this.selection.configRoot);
        if (
            beforeIntent.readOnlyReason ||
            beforeIntent.pluginEnabled === false ||
            (this.configReceipt !== undefined && beforeIntent.snapshot !== this.configReceipt) ||
            (host === 'codex' && !absent && beforeIntent.snapshot !== this.configReceipt)
        )
            throw new Error('configuration-changed');
        const args = absent
            ? [
                  'plugin',
                  'marketplace',
                  'add',
                  this.selection.marketplaceSource,
                  ...(host === 'claude' ? ['--scope', 'user'] : []),
                  '--json',
              ]
            : ['plugin', 'marketplace', host === 'codex' ? 'upgrade' : 'update', OWN_PLUGIN, '--json'];
        const result = await this.command(args, host === 'claude');
        if (!isRecord(result)) throw new Error('marketplace-refresh-failed');
        if (host === 'claude') {
            if (
                result.outcome !== 'ok' ||
                result.marketplace !== OWN_PLUGIN ||
                result.command !== (absent ? 'marketplace-add' : 'marketplace-update')
            )
                throw new Error('marketplace-refresh-failed');
        } else if (absent) {
            if (
                result.marketplaceName !== OWN_PLUGIN ||
                typeof result.installedRoot !== 'string' ||
                !path.isAbsolute(result.installedRoot) ||
                typeof result.alreadyAdded !== 'boolean'
            )
                throw new Error('marketplace-refresh-failed');
        } else if (
            !Array.isArray(result.selectedMarketplaces) ||
            result.selectedMarketplaces.length !== 1 ||
            result.selectedMarketplaces[0] !== OWN_PLUGIN ||
            !Array.isArray(result.upgradedRoots) ||
            !result.upgradedRoots.every((root: unknown) => typeof root === 'string' && path.isAbsolute(root)) ||
            !Array.isArray(result.errors) ||
            result.errors.length !== 0
        )
            throw new Error('marketplace-refresh-failed');
        const afterIntent = await readHostUserIntent(host, this.selection.configRoot);
        assertNativeIntentTransition(
            beforeIntent,
            afterIntent,
            this.selection.marketplaceSource,
            absent ? 'marketplace-add' : 'marketplace-refresh',
        );
        this.configReceipt = afterIntent.snapshot;
    }

    async installOrUpdate(installed: boolean, version: string): Promise<void> {
        const host = this.selection.host;
        const beforeIntent = await readHostUserIntent(host, this.selection.configRoot);
        if (
            beforeIntent.readOnlyReason ||
            beforeIntent.pluginEnabled === false ||
            (this.configReceipt !== undefined && beforeIntent.snapshot !== this.configReceipt) ||
            (host === 'codex' && beforeIntent.snapshot !== this.configReceipt)
        )
            throw new Error('configuration-changed');
        const result = await this.command(
            host === 'codex'
                ? ['plugin', 'add', OWN_PLUGIN_ID, '--json']
                : ['plugin', installed ? 'update' : 'install', OWN_PLUGIN_ID, '--scope', 'user', '--json'],
            host === 'claude',
        );
        if (!isRecord(result)) throw new Error('invalid-native-output');
        if (host === 'codex') {
            if (
                result.pluginId !== OWN_PLUGIN_ID ||
                result.name !== OWN_PLUGIN ||
                result.marketplaceName !== OWN_PLUGIN ||
                result.version !== version
            )
                throw new Error('native-install-identity-mismatch');
            this.receipt = { root: await canonicalPluginRoot(requiredString(result.installedPath)), version };
        } else if (
            result.outcome !== 'ok' ||
            result.pluginId !== OWN_PLUGIN_ID ||
            result.scope !== 'user' ||
            result.command !== (installed ? 'update' : 'install')
        )
            throw new Error('native-install-failed');
        const afterIntent = await readHostUserIntent(host, this.selection.configRoot);
        assertNativeIntentTransition(beforeIntent, afterIntent, this.selection.marketplaceSource, 'plugin-install');
        this.configReceipt = afterIntent.snapshot;
    }

    async captureManagedReceipt(root: string, version: string): Promise<NativeManagedReceipt> {
        const intent = await readHostUserIntent(this.selection.host, this.selection.configRoot);
        const canonical = await canonicalPluginRoot(root);
        if (
            intent.snapshot !== this.configReceipt ||
            intent.readOnlyReason ||
            intent.pluginEnabled !== true ||
            intent.marketplaceSource !== this.selection.marketplaceSource ||
            (this.selection.host === 'codex' && (this.receipt?.root !== canonical || this.receipt.version !== version))
        )
            throw new Error('configuration-changed');
        return { root: canonical, version, configuration: intent.snapshot };
    }

    async restoreManagedReceipt(receipt: NativeManagedReceipt): Promise<void> {
        try {
            const intent = await readHostUserIntent(this.selection.host, this.selection.configRoot);
            if (
                intent.snapshot !== receipt.configuration ||
                intent.readOnlyReason ||
                intent.pluginEnabled !== true ||
                intent.marketplaceSource !== this.selection.marketplaceSource ||
                !isSemVer(receipt.version)
            )
                throw new Error();
            const root = await canonicalPluginRoot(receipt.root);
            this.receipt = { root, version: receipt.version };
            this.configReceipt = receipt.configuration;
            const inventory = await this.inspect();
            const users = inventory.installations.filter((item) => item.scope === 'user');
            if (
                inventory.readOnlyReason ||
                inventory.marketplace?.readOnlyReason ||
                users.length !== 1 ||
                users[0]?.readOnlyReason ||
                users[0]?.root !== root ||
                users[0].version !== receipt.version ||
                !users[0].enabled
            )
                throw new Error();
        } catch {
            this.receipt = undefined;
            this.configReceipt = undefined;
            throw new Error('managed-receipt-host-changed');
        }
    }
}
