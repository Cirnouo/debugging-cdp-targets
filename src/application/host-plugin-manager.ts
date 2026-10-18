import { readGitPluginSource } from '../adapters/git-plugin-source.ts';
import {
    createManagedPluginReceipt,
    type HostPluginReceiptStore,
    type ManagedPluginReceipt,
    type NativeManagedReceipt,
    parseManagedPluginReceipt,
    type ReceiptHostSelection,
    receiptMatchesSelection,
    restoreReceiptFiles,
} from '../adapters/managed-plugin-receipts.ts';
import { type HostInventory, type NativeHostPluginAdapter, verifyCatalog } from '../adapters/native-host-plugins.ts';
import {
    type PluginFiles,
    patchPluginEndpoint,
    readPluginTree,
    verifyPluginFiles,
} from '../adapters/verified-plugin-files.ts';
import {
    decidePluginUpdate,
    type PluginHost,
    parseStablePluginRecord,
    type StablePluginRecord,
    validateAppEndpoint,
} from '../domains/host-management.ts';

export interface HostPluginSummary {
    host: PluginHost;
    state:
        | 'no-candidate'
        | 'app-update-required'
        | 'invalid-record'
        | 'read-only'
        | 'inspected'
        | 'failed'
        | 'partial-failure'
        | 'newer-installed'
        | 'busy'
        | 'disk-synchronized';
    activation: 'reload-pending' | 'unverified';
    candidate?: 'no-candidate' | 'app-update-required' | 'newer-installed';
    reason?: string;
    version?: string;
    installations?: {
        version: string;
        scope: string;
        enabled: boolean;
        pathResolved: boolean;
        readOnlyReason?: string;
    }[];
}

export interface ReviewedPluginSource {
    files: PluginFiles;
    catalog: Record<string, unknown>;
}

type HostAdapter = Pick<NativeHostPluginAdapter, 'inspect' | 'refreshMarketplace' | 'installOrUpdate'> & {
    selection: Pick<NativeHostPluginAdapter['selection'], 'host' | 'marketplaceSource'> &
        Partial<Pick<NativeHostPluginAdapter['selection'], 'configRoot' | 'executable' | 'pluginRoot'>>;
    captureManagedReceipt?: (root: string, version: string) => Promise<NativeManagedReceipt>;
    restoreManagedReceipt?: (receipt: NativeManagedReceipt) => Promise<void>;
};

function readOnly(inventory: HostInventory, allowUnresolved = false): string | undefined {
    const disabled = inventory.installations.find(
        (item) => !item.enabled && (inventory.host === 'codex' || item.scope === 'user'),
    );
    if (disabled) return 'disabled';
    return (
        inventory.readOnlyReason ??
        inventory.marketplace?.readOnlyReason ??
        inventory.installations.find(
            (item) =>
                (inventory.host === 'codex' || item.scope === 'user') &&
                item.readOnlyReason &&
                !(allowUnresolved && item.readOnlyReason === 'existing-unresolved'),
        )?.readOnlyReason
    );
}

function summary(inventory: HostInventory): Pick<HostPluginSummary, 'installations'> {
    return {
        installations: inventory.installations.map((item) => ({
            version: item.version,
            scope: item.scope,
            enabled: item.enabled,
            pathResolved: item.root !== undefined,
            ...(item.readOnlyReason ? { readOnlyReason: item.readOnlyReason } : {}),
        })),
    };
}

/** GUI service: independently inspect and synchronize selected hosts against one reviewed latest record. */
export class HostPluginManager {
    private readonly appVersion: string;
    private readonly adapters: HostAdapter[];
    private readonly readSource: (record: StablePluginRecord, host: PluginHost) => Promise<ReviewedPluginSource>;
    private readonly patchEndpoint: typeof patchPluginEndpoint;
    private readonly receiptStore: HostPluginReceiptStore | undefined;
    private readonly busy = new Set<PluginHost>();
    private readonly synchronized = new Map<
        PluginHost,
        {
            record: StablePluginRecord;
            files: PluginFiles;
            root: string;
            pendingReceipt?: ManagedPluginReceipt;
            reloadPending?: boolean;
        }
    >();

    constructor(options: {
        appVersion: string;
        adapters: HostAdapter[];
        readSource?: (record: StablePluginRecord, host: PluginHost) => Promise<ReviewedPluginSource>;
        patchEndpoint?: typeof patchPluginEndpoint;
        receiptStore?: HostPluginReceiptStore;
    }) {
        this.appVersion = options.appVersion;
        this.adapters = options.adapters;
        if (new Set(options.adapters.map((adapter) => adapter.selection.host)).size !== options.adapters.length)
            throw new Error('duplicate-host-selection');
        this.readSource = options.readSource ?? readGitPluginSource;
        this.patchEndpoint = options.patchEndpoint ?? patchPluginEndpoint;
        this.receiptStore = options.receiptStore;
    }

    async inspect(host?: PluginHost): Promise<HostPluginSummary[]> {
        return Promise.all(
            this.selectedAdapters(host).map(async (adapter) => {
                if (this.busy.has(adapter.selection.host))
                    return { host: adapter.selection.host, state: 'busy' as const, activation: 'unverified' as const };
                this.busy.add(adapter.selection.host);
                try {
                    await this.ensureManagedReceipt(adapter);
                    const inventory = await adapter.inspect();
                    const reason = readOnly(inventory);
                    return {
                        host: inventory.host,
                        state: reason ? 'read-only' : 'inspected',
                        activation: this.inspectionActivation(inventory),
                        ...(reason ? { reason } : {}),
                        ...summary(inventory),
                    };
                } catch (error) {
                    const failure = this.failure(adapter.selection.host, false, error);
                    const retained = this.synchronized.get(adapter.selection.host);
                    if (
                        retained?.reloadPending &&
                        [
                            'cli-missing',
                            'invalid-native-output',
                            'native-command-failed',
                            'native-command-timeout',
                            'native-output-too-large',
                        ].includes(failure.reason ?? '')
                    )
                        return { ...failure, activation: 'reload-pending' };
                    if (retained) delete retained.reloadPending;
                    return failure;
                } finally {
                    this.busy.delete(adapter.selection.host);
                }
            }),
        );
    }

    private inspectionActivation(inventory: HostInventory): HostPluginSummary['activation'] {
        const retained = this.synchronized.get(inventory.host);
        if (!retained?.reloadPending) return 'unverified';
        const own = inventory.installations.filter((item) => item.scope === 'user');
        const restrictions = [
            inventory.readOnlyReason,
            inventory.marketplace?.readOnlyReason,
            ...own.map((item) => item.readOnlyReason),
        ];
        try {
            if (
                own.length !== 1 ||
                own[0]?.root !== retained.root ||
                own[0]?.version !== retained.record.version ||
                inventory.marketplace?.source !== retained.record.source.url ||
                !inventory.catalog ||
                restrictions.some(
                    (reason) => reason && !['disabled', 'plugin-in-use', 'shared-installation'].includes(reason),
                )
            )
                throw new Error('changed-copy');
            verifyCatalog(retained.record, inventory.host, inventory.catalog);
            return 'reload-pending';
        } catch {
            delete retained.reloadPending;
            return 'unverified';
        }
    }

    async synchronize(value: unknown, effectiveEndpoint: string, host?: PluginHost): Promise<HostPluginSummary[]> {
        const adapters = this.selectedAdapters(host);
        let record: StablePluginRecord | null;
        try {
            record = parseStablePluginRecord(value);
            validateAppEndpoint(effectiveEndpoint);
        } catch {
            return adapters.map((adapter) => ({
                host: adapter.selection.host,
                state: 'invalid-record',
                activation: 'unverified',
            }));
        }
        const decision = decidePluginUpdate(this.appVersion, record);
        if (decision === 'no-candidate' || decision === 'app-update-required')
            return Promise.all(
                adapters.map((adapter) => this.synchronizeExisting(adapter, effectiveEndpoint, decision)),
            );
        if (!record) throw new Error('missing-record');
        return Promise.all(adapters.map((adapter) => this.synchronizeHost(adapter, record, effectiveEndpoint)));
    }

    private selectedAdapters(host?: PluginHost) {
        const selected =
            host === undefined ? this.adapters : this.adapters.filter((adapter) => adapter.selection.host === host);
        if (selected.length === 0) throw new Error('host-selection-missing');
        return selected;
    }

    private receiptSelection(adapter: HostAdapter): ReceiptHostSelection {
        const selection = adapter.selection;
        if (selection.configRoot === undefined) throw new Error('managed-receipt-unavailable');
        return {
            configRoot: selection.configRoot,
            marketplaceSource: selection.marketplaceSource,
            ...(selection.executable === undefined ? {} : { executable: selection.executable }),
            ...(selection.pluginRoot === undefined ? {} : { pluginRoot: selection.pluginRoot }),
        };
    }

    private async ensureManagedReceipt(adapter: HostAdapter): Promise<void> {
        const host = adapter.selection.host;
        const retained = this.synchronized.get(host);
        if (retained) {
            try {
                verifyPluginFiles(
                    host,
                    retained.record.version,
                    retained.files,
                    await readPluginTree(retained.root, host),
                );
            } catch {
                throw new Error('managed-receipt-payload-changed');
            }
            return;
        }
        if (!this.receiptStore) return;
        const value = await this.receiptStore.read(host);
        if (value === undefined) return;
        const receipt = parseManagedPluginReceipt(value);
        if (receipt.host !== host || !receiptMatchesSelection(receipt, this.receiptSelection(adapter)))
            throw new Error('managed-receipt-selection-changed');
        const files = await restoreReceiptFiles(receipt);
        if (!adapter.restoreManagedReceipt) throw new Error('managed-receipt-unavailable');
        await adapter.restoreManagedReceipt(receipt.native);
        this.synchronized.set(host, { record: receipt.record, files, root: receipt.native.root });
    }

    private failure(host: PluginHost, mutated: boolean, error: unknown): HostPluginSummary {
        const code = error instanceof Error ? error.message : '';
        const allowed = [
            'cli-missing',
            'invalid-native-output',
            'native-command-failed',
            'native-command-timeout',
            'native-output-too-large',
            'marketplace-source-moved',
            'marketplace-refresh-failed',
            'native-install-identity-mismatch',
            'native-install-failed',
            'plugin-url-write-failed',
            'plugin-url-readback-failed',
            'invalid-host-selection',
            'invalid-managed-receipt',
            'managed-receipt-selection-changed',
            'managed-receipt-payload-changed',
            'managed-receipt-host-changed',
            'managed-receipt-write-failed',
            'configuration-changed',
        ];
        return {
            host,
            state: mutated
                ? 'partial-failure'
                : [
                        'configuration-changed',
                        'managed-receipt-host-changed',
                        'managed-receipt-payload-changed',
                        'managed-receipt-selection-changed',
                    ].includes(code)
                  ? 'read-only'
                  : 'failed',
            activation: 'unverified',
            reason: allowed.includes(code) ? code : 'verification-failed',
        };
    }

    private async synchronizeHost(
        adapter: HostAdapter,
        record: StablePluginRecord,
        endpoint: string,
    ): Promise<HostPluginSummary> {
        const host = adapter.selection.host;
        if (this.busy.has(host)) return { host, state: 'busy', activation: 'unverified' };
        this.busy.add(host);
        let mutated = false;
        try {
            await this.ensureManagedReceipt(adapter);
            const before = await adapter.inspect();
            const reason = readOnly(before);
            if (reason) return { host, state: 'read-only', activation: 'unverified', reason, ...summary(before) };
            const installation = before.installations.find((item) => item.scope === 'user');
            const decision = decidePluginUpdate(this.appVersion, record, installation?.version);
            const retained = this.synchronized.get(host);
            if (decision === 'newer-installed') {
                if (retained) return await this.synchronizeRetained(adapter, endpoint, 'newer-installed', before);
                return {
                    host,
                    state: 'read-only',
                    reason: 'newer-installed-unmanaged',
                    activation: 'unverified',
                    ...summary(before),
                };
            }
            if (
                decision === 'sync' &&
                retained &&
                retained.record.version === record.version &&
                retained.record.source.url === record.source.url &&
                retained.record.source.sha === record.source.sha
            )
                return await this.synchronizeRetained(adapter, endpoint, undefined, before);
            if (adapter.selection.marketplaceSource !== record.source.url)
                return { host, state: 'read-only', activation: 'unverified', reason: 'marketplace-source-or-pin' };
            const source = await this.readSource(record, host);
            verifyCatalog(record, host, source.catalog);
            // A failed/timed-out native mutation can already have modified host state.
            mutated = true;
            await adapter.refreshMarketplace(!before.marketplace);
            const refreshed = await adapter.inspect();
            const refreshReason = readOnly(refreshed, host === 'codex' && installation !== undefined);
            if (refreshReason || !refreshed.catalog) throw new Error('marketplace-source-moved');
            verifyCatalog(record, host, refreshed.catalog);
            await adapter.installOrUpdate(installation !== undefined, record.version);
            const installed = await adapter.inspect();
            if (readOnly(installed) || !installed.catalog) throw new Error('native-install-identity-mismatch');
            verifyCatalog(record, host, installed.catalog);
            const own = installed.installations.find((item) => item.scope === 'user');
            if (!own?.root || own.version !== record.version || !own.enabled)
                throw new Error('native-install-identity-mismatch');
            verifyPluginFiles(host, record.version, source.files, await readPluginTree(own.root, host));
            const checkpoint: {
                record: StablePluginRecord;
                files: PluginFiles;
                root: string;
                pendingReceipt?: ManagedPluginReceipt;
                reloadPending?: boolean;
            } = { record, files: source.files, root: own.root };
            if (this.receiptStore) {
                if (!adapter.captureManagedReceipt) throw new Error('managed-receipt-unavailable');
                const native = await adapter.captureManagedReceipt(own.root, record.version);
                checkpoint.pendingReceipt = createManagedPluginReceipt(
                    host,
                    this.receiptSelection(adapter),
                    native,
                    record,
                    source.files,
                );
            }
            // Account for the verified native replacement before any later URL/store failure.
            this.synchronized.set(host, checkpoint);
            await this.persistCheckpoint(host);
            await this.patchEndpoint(host, own.root, record.version, source.files, endpoint);
            const after = await adapter.inspect();
            if (
                readOnly(after) ||
                !after.catalog ||
                !after.installations.some(
                    (item) => item.root === own.root && item.version === record.version && item.enabled,
                )
            )
                throw new Error('native-install-identity-mismatch');
            verifyCatalog(record, host, after.catalog);
            checkpoint.reloadPending = true;
            return { host, state: 'disk-synchronized', activation: 'reload-pending', version: record.version };
        } catch (error) {
            return this.failure(host, mutated, error);
        } finally {
            this.busy.delete(host);
        }
    }

    private async persistCheckpoint(host: PluginHost): Promise<void> {
        const checkpoint = this.synchronized.get(host);
        if (checkpoint?.pendingReceipt && this.receiptStore) {
            await this.receiptStore.write(host, checkpoint.pendingReceipt);
            delete checkpoint.pendingReceipt;
        }
    }

    private async synchronizeExisting(
        adapter: HostAdapter,
        endpoint: string,
        candidate: 'no-candidate' | 'app-update-required',
    ): Promise<HostPluginSummary> {
        const host = adapter.selection.host;
        if (this.busy.has(host)) return { host, state: 'busy', activation: 'unverified', candidate };
        this.busy.add(host);
        try {
            await this.ensureManagedReceipt(adapter);
            return await this.synchronizeRetained(adapter, endpoint, candidate);
        } catch (error) {
            return { ...this.failure(host, false, error), candidate };
        } finally {
            this.busy.delete(host);
        }
    }

    private async synchronizeRetained(
        adapter: HostAdapter,
        endpoint: string,
        candidate?: HostPluginSummary['candidate'],
        inventory?: HostInventory,
    ): Promise<HostPluginSummary> {
        const host = adapter.selection.host;
        let mutated = false;
        try {
            const receipt = this.synchronized.get(host);
            if (!receipt) return { host, state: candidate ?? 'no-candidate', activation: 'unverified' };
            if (decidePluginUpdate(this.appVersion, receipt.record) === 'app-update-required')
                return { host, state: 'app-update-required', activation: 'unverified' };
            const before = inventory ?? (await adapter.inspect());
            const reason = readOnly(before);
            if (reason)
                return {
                    host,
                    state: 'read-only',
                    activation: 'unverified',
                    ...(candidate ? { candidate } : {}),
                    reason,
                    ...summary(before),
                };
            const own = before.installations.find((item) => item.scope === 'user');
            if (!before.catalog || own?.root !== receipt.root || own.version !== receipt.record.version || !own.enabled)
                throw new Error('native-install-identity-mismatch');
            verifyCatalog(receipt.record, host, before.catalog);
            mutated = true;
            await this.persistCheckpoint(host);
            await this.patchEndpoint(host, receipt.root, receipt.record.version, receipt.files, endpoint);
            const after = await adapter.inspect();
            if (
                readOnly(after) ||
                !after.catalog ||
                !after.installations.some(
                    (item) => item.root === own.root && item.version === own.version && item.enabled,
                )
            )
                throw new Error('native-install-identity-mismatch');
            verifyCatalog(receipt.record, host, after.catalog);
            receipt.reloadPending = true;
            return {
                host,
                state: 'disk-synchronized',
                ...(candidate ? { candidate } : {}),
                version: receipt.record.version,
                activation: 'reload-pending',
            };
        } catch (error) {
            return { ...this.failure(host, mutated, error), ...(candidate ? { candidate } : {}) };
        }
    }
}
