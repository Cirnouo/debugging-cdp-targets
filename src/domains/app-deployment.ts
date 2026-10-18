import { isRecord } from '../shared/errors.ts';

export type DeploymentInstallation = Readonly<{
    schemaVersion: 1;
    installationId: string;
    kind: 'installed' | 'portable';
    platform: 'win32' | 'darwin' | 'linux';
    architecture: 'x64' | 'arm64';
    root: Readonly<{ realPath: string; device: string; inode: string }>;
}>;
export type DeploymentSelection = Readonly<{ selectedBuildId: string; selectedManifestSha256: string }>;
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
