import { isRecord } from '../shared/errors.ts';
import { isOfficialRelativePath } from '../shared/official-package.ts';

export type DeploymentInstallation = Readonly<{
    schemaVersion: 1;
    installationId: string;
    kind: 'installed' | 'portable';
    platform: 'win32' | 'darwin' | 'linux';
    architecture: 'x64' | 'arm64';
    root: Readonly<{ realPath: string; device: string; inode: string }>;
}>;
export type DeploymentSelection = Readonly<{ selectedBuildId: string; selectedManifestSha256: string }>;
export type DeploymentPayloadEntry =
    | Readonly<{ type: 'directory'; path: string; executableBits: number | null }>
    | Readonly<{ type: 'file'; path: string; bytes: number; sha256: string; executableBits: number | null }>
    | Readonly<{ type: 'symlink'; path: string; target: string }>;
export type DeploymentPayloadManifest = Readonly<{
    schemaVersion: 1;
    platform: DeploymentInstallation['platform'];
    architecture: DeploymentInstallation['architecture'];
    entries: readonly DeploymentPayloadEntry[];
}>;
export type DeploymentState = DeploymentSelection &
    Readonly<{
        schemaVersion: 1;
        installationIdentity: string;
        phase: 'active' | 'removing' | 'removed';
    }>;
export type DeploymentTransition =
    | (Readonly<{ type: 'select' }> & DeploymentSelection)
    | Readonly<{ type: 'begin-removal' | 'cancel-removal' | 'finish-removal' }>;

function fields(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
        throw new Error('Malformed deployment fields.');
}

function digest(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function payloadDemand(condition: unknown): asserts condition {
    if (!condition) throw new Error('Invalid deployment payload manifest.');
}

function payloadEncoding(manifest: DeploymentPayloadManifest): string {
    const text = `${JSON.stringify(manifest)}\n`;
    payloadDemand(new TextEncoder().encode(text).byteLength <= 16 * 1024 * 1024);
    return text;
}

function payloadLinks(entries: ReadonlyMap<string, DeploymentPayloadEntry>): void {
    const resolved = new Map<string, string>();
    for (const entry of entries.values()) {
        if (entry.type !== 'symlink') continue;
        const parents = entry.path.split('/').slice(0, -1);
        const appIndex = parents.findLastIndex((part) => part.endsWith('.app'));
        payloadDemand(appIndex >= 0 && parents.some((part, index) => index > appIndex && part.endsWith('.framework')));
        const app = parents.slice(0, appIndex + 1).join('/');
        let current = [...parents];
        const active = new Set([entry.path]);
        const frames = [{ link: entry.path, parts: entry.target.split('/'), index: 0 }];
        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            if (!frame) throw new Error('Invalid deployment payload link graph.');
            const part = frame.parts[frame.index++];
            if (part === undefined) {
                const destination = current.join('/');
                payloadDemand(entries.has(destination) && (destination === app || destination.startsWith(`${app}/`)));
                resolved.set(frame.link, destination);
                active.delete(frame.link);
                frames.pop();
                continue;
            }
            payloadDemand(current.length === 0 || entries.get(current.join('/'))?.type === 'directory');
            if (part === '.') continue;
            if (part === '..') {
                payloadDemand(current.length > 0);
                current.pop();
                continue;
            }
            const name = [...current, part].join('/');
            const target = entries.get(name);
            payloadDemand(target);
            if (target.type === 'symlink') {
                payloadDemand(!active.has(name));
                const cached = resolved.get(name);
                if (cached !== undefined) current = cached.split('/');
                else {
                    active.add(name);
                    frames.push({ link: name, parts: target.target.split('/'), index: 0 });
                }
            } else current.push(part);
        }
    }
    if (resolved.size === 0) return;
    const edges = new Map<string, string[]>();
    for (const entry of entries.values()) {
        const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
        if (entry.path.includes('/')) {
            const children = edges.get(parent) ?? [];
            children.push(entry.path);
            edges.set(parent, children);
        }
        const target = resolved.get(entry.path);
        if (target !== undefined) edges.set(entry.path, [target]);
    }
    const colors = new Map<string, 'active' | 'done'>();
    for (const name of entries.keys()) {
        const pending = [{ name, finish: false }];
        while (pending.length > 0) {
            const step = pending.pop();
            if (!step) throw new Error('Invalid deployment payload link graph.');
            if (step.finish) colors.set(step.name, 'done');
            else {
                payloadDemand(colors.get(step.name) !== 'active');
                if (colors.get(step.name) === 'done') continue;
                colors.set(step.name, 'active');
                pending.push({ name: step.name, finish: true });
                for (const child of edges.get(step.name) ?? []) pending.push({ name: child, finish: false });
            }
        }
    }
}

/** A complete explicit inventory is syntax/content input, never provenance or enrollment proof. */
export function parseDeploymentPayloadManifest(value: unknown): DeploymentPayloadManifest {
    fields(value, ['schemaVersion', 'platform', 'architecture', 'entries']);
    const { schemaVersion, platform, architecture, entries: inputs } = value;
    payloadDemand(Array.isArray(inputs));
    const inputCount = inputs.length;
    payloadDemand(
        schemaVersion === 1 &&
            (platform === 'win32' || platform === 'darwin' || platform === 'linux') &&
            (architecture === 'x64' || architecture === 'arm64') &&
            Number.isSafeInteger(inputCount) &&
            inputCount >= 0 &&
            inputCount <= 100000,
    );
    const entries: DeploymentPayloadEntry[] = [];
    const byPath = new Map<string, DeploymentPayloadEntry>();
    const aliases = new Set<string>();
    let previous = '';
    for (let index = 0; index < inputCount; index++) {
        const input = inputs[index];
        payloadDemand(isRecord(input));
        const type = input.type;
        fields(
            input,
            type === 'symlink'
                ? ['type', 'path', 'target']
                : type === 'file'
                  ? ['type', 'path', 'bytes', 'sha256', 'executableBits']
                  : ['type', 'path', 'executableBits'],
        );
        const name = input.path;
        payloadDemand(isOfficialRelativePath(name) && name.isWellFormed() && name.normalize('NFC') === name);
        const alias = name.toLowerCase().normalize('NFC');
        payloadDemand(
            name > previous && !aliases.has(alias) && name.split('/')[0]?.toLowerCase() !== 'payload-manifest.json',
        );
        const slash = name.lastIndexOf('/');
        payloadDemand(slash < 0 || byPath.get(name.slice(0, slash))?.type === 'directory');
        let entry: DeploymentPayloadEntry;
        if (type === 'symlink') {
            const target = input.target;
            payloadDemand(platform === 'darwin' && typeof target === 'string' && target.isWellFormed());
            payloadDemand(
                target.length > 0 &&
                    target.split('/').every((part) => part === '.' || part === '..' || isOfficialRelativePath(part)),
            );
            entry = Object.freeze({ type: 'symlink', path: name, target });
        } else {
            const bits = input.executableBits;
            payloadDemand(bits === null || typeof bits === 'number');
            payloadDemand(
                platform === 'win32'
                    ? bits === null
                    : typeof bits === 'number' &&
                          Number.isInteger(bits) &&
                          bits >= 0 &&
                          bits <= 0o111 &&
                          (bits & 0o111) === bits,
            );
            if (type === 'file') {
                const { bytes, sha256 } = input;
                payloadDemand(typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 && digest(sha256));
                entry = Object.freeze({
                    type: 'file',
                    path: name,
                    bytes,
                    sha256,
                    executableBits: bits,
                });
            } else {
                payloadDemand(type === 'directory');
                entry = Object.freeze({ type: 'directory', path: name, executableBits: bits });
            }
        }
        entries.push(entry);
        byPath.set(name, entry);
        aliases.add(alias);
        previous = name;
    }
    payloadLinks(byPath);
    const manifest = Object.freeze({
        schemaVersion: 1 as const,
        platform,
        architecture,
        entries: Object.freeze(entries),
    });
    payloadEncoding(manifest);
    return manifest;
}

export function encodeDeploymentPayloadManifest(value: unknown): string {
    return payloadEncoding(parseDeploymentPayloadManifest(value));
}

function physicalPath(value: unknown, windows: boolean): value is string {
    if (typeof value !== 'string' || value.includes('\0') || value.length > 32768) return false;
    if (windows ? !/^[A-Za-z]:\\/.test(value) : !value.startsWith('/')) return false;
    return !value.split(windows ? /[/\\]/ : '/').some((part) => part === '.' || part === '..');
}

export function parseDeploymentInstallation(value: unknown): DeploymentInstallation {
    fields(value, ['schemaVersion', 'installationId', 'kind', 'platform', 'architecture', 'root']);
    fields(value.root, ['realPath', 'device', 'inode']);
    if (
        value.schemaVersion !== 1 ||
        typeof value.installationId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.installationId) ||
        (value.kind !== 'installed' && value.kind !== 'portable') ||
        (value.platform !== 'win32' && value.platform !== 'darwin' && value.platform !== 'linux') ||
        (value.architecture !== 'x64' && value.architecture !== 'arm64') ||
        !physicalPath(value.root.realPath, value.platform === 'win32') ||
        typeof value.root.device !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(value.root.device) ||
        typeof value.root.inode !== 'string' ||
        !/^[1-9][0-9]*$/.test(value.root.inode)
    )
        throw new Error('Invalid or unsupported deployment installation.');
    return Object.freeze({
        schemaVersion: 1,
        installationId: value.installationId,
        kind: value.kind,
        platform: value.platform,
        architecture: value.architecture,
        root: Object.freeze({ realPath: value.root.realPath, device: value.root.device, inode: value.root.inode }),
    });
}

export function parseDeploymentState(value: unknown, installationIdentity: string): DeploymentState {
    fields(value, ['schemaVersion', 'installationIdentity', 'phase', 'selectedBuildId', 'selectedManifestSha256']);
    if (
        value.schemaVersion !== 1 ||
        !digest(installationIdentity) ||
        value.installationIdentity !== installationIdentity ||
        (value.phase !== 'active' && value.phase !== 'removing' && value.phase !== 'removed') ||
        !digest(value.selectedBuildId) ||
        !digest(value.selectedManifestSha256)
    )
        throw new Error('Invalid, foreign or unsupported deployment state.');
    return Object.freeze({
        schemaVersion: 1,
        installationIdentity,
        phase: value.phase,
        selectedBuildId: value.selectedBuildId,
        selectedManifestSha256: value.selectedManifestSha256,
    });
}

/** Selection syntax is not payload proof. Delivery verifies the complete closure before calling. */
export function transitionDeploymentState(value: unknown, action: unknown): DeploymentState {
    if (!isRecord(value) || typeof value.installationIdentity !== 'string')
        throw new Error('Invalid deployment state.');
    const state = parseDeploymentState(value, value.installationIdentity);
    if (!isRecord(action)) throw new Error('Invalid deployment transition.');
    if (action.type === 'select') {
        fields(action, ['type', 'selectedBuildId', 'selectedManifestSha256']);
        if (state.phase !== 'active') throw new Error('Selection is fenced by removal.');
        const next = parseDeploymentState(
            {
                ...state,
                selectedBuildId: action.selectedBuildId,
                selectedManifestSha256: action.selectedManifestSha256,
            },
            state.installationIdentity,
        );
        const sameBuild = next.selectedBuildId === state.selectedBuildId;
        const sameManifest = next.selectedManifestSha256 === state.selectedManifestSha256;
        if (sameBuild !== sameManifest) throw new Error('Immutable build and manifest identities disagree.');
        return next;
    }
    fields(action, ['type']);
    const phase =
        action.type === 'begin-removal' && state.phase === 'active'
            ? 'removing'
            : action.type === 'cancel-removal' && state.phase === 'removing'
              ? 'active'
              : action.type === 'finish-removal' && state.phase === 'removing'
                ? 'removed'
                : undefined;
    if (phase === undefined) throw new Error('Invalid deployment phase transition.');
    return Object.freeze({ ...state, phase });
}
