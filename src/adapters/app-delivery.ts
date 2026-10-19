import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
    type DeploymentInstallation,
    type DeploymentPayloadManifest,
    type DeploymentSelection,
    encodeDeploymentPayloadManifest,
    parseDeploymentPayloadManifest,
} from '../domains/app-deployment.ts';
import type { AppReleaseFile } from '../domains/app-release.ts';
import { isRecord } from '../shared/errors.ts';
import { isPortablePayloadRelativePath } from '../shared/payload-path.ts';
import { readRegularFile } from './file-evidence.ts';

function matches(bytes: Buffer, evidence: { bytes: number; sha256: string }): boolean {
    return bytes.length === evidence.bytes && createHash('sha256').update(bytes).digest('hex') === evidence.sha256;
}

export async function verifyAppArchive(file: string, evidence: { bytes: number; sha256: string }): Promise<void> {
    if (!matches(await readRegularFile(file), evidence)) throw new Error('App archive digest or length changed.');
}

/** Verify exact delivered bytes, without executing, repairing or following release-tree links. */
export async function verifyAppReleaseTree(directory: string, inventory: readonly AppReleaseFile[]) {
    const root = path.resolve(directory);
    const rootEntry = await lstat(root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || path.relative(root, await realpath(root)) !== '')
        throw new Error('App release root must be a canonical regular directory.');
    const expected = new Map<string, AppReleaseFile>();
    const directories = new Set<string>();
    for (const file of inventory) {
        if (!isPortablePayloadRelativePath(file.path) || expected.has(file.path))
            throw new Error('Invalid App release inventory.');
        expected.set(file.path, file);
        for (let parent = path.posix.dirname(file.path); parent !== '.'; parent = path.posix.dirname(parent))
            directories.add(parent);
    }
    const verified = new Map<string, Buffer>();
    async function walk(current: string, prefix = ''): Promise<void> {
        for (const name of await readdir(current)) {
            const relative = `${prefix}${name}`;
            const absolute = path.join(current, name);
            const entry = await lstat(absolute);
            if (
                entry.isSymbolicLink() ||
                path.relative(root, await realpath(absolute)).replaceAll('\\', '/') !== relative
            )
                throw new Error('App release contains a linked or changed path.');
            if (entry.isDirectory()) {
                if (!directories.has(relative)) throw new Error(`Unexpected App release directory: ${relative}`);
                await walk(absolute, `${relative}/`);
            } else {
                const file = expected.get(relative);
                if (!entry.isFile() || !file) throw new Error(`Unexpected App release file: ${relative}`);
                const bytes = await readRegularFile(absolute);
                if (!matches(bytes, file)) throw new Error(`App release file digest or length changed: ${relative}`);
                verified.set(relative, bytes);
            }
        }
    }
    await walk(root);
    for (const file of expected.keys()) if (!verified.has(file)) throw new Error(`Missing App release file: ${file}`);
    return verified;
}

/** Identify caller-supplied content only; no discovery, provenance or enrollment is implied. */
export function identifyDeploymentPayload(value: unknown): Readonly<{
    manifest: DeploymentPayloadManifest;
    canonicalManifest: string;
    selectedBuildId: string;
    selectedManifestSha256: string;
}> {
    const manifest = parseDeploymentPayloadManifest(value);
    const canonicalManifest = encodeDeploymentPayloadManifest(manifest);
    const digest = createHash('sha256').update(canonicalManifest, 'utf8').digest('hex');
    return Object.freeze({ manifest, canonicalManifest, selectedBuildId: digest, selectedManifestSha256: digest });
}

type PayloadIo = {
    lstat?: (name: string) => Promise<BigIntStats>;
    realpath?: (name: string) => Promise<string>;
    readdir?: (name: string) => Promise<string[]>;
    readlink?: (name: string) => Promise<string>;
    open?: NonNullable<Parameters<typeof readRegularFile>[1]>['open'];
};

function payloadUnchanged(before: BigIntStats, after: BigIntStats): boolean {
    return (
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.mode === after.mode &&
        before.nlink === after.nlink &&
        before.size === after.size &&
        before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs &&
        before.isFile() === after.isFile() &&
        before.isDirectory() === after.isDirectory() &&
        before.isSymbolicLink() === after.isSymbolicLink()
    );
}

/** Read-only observed content agreement. Native authority and protected lifetime belong to callers. */
export async function verifyDeploymentPayload(
    directory: string,
    expected: Readonly<
        DeploymentSelection & {
            platform: DeploymentInstallation['platform'];
            architecture: DeploymentInstallation['architecture'];
        }
    >,
    io: PayloadIo = {},
): Promise<
    Readonly<{
        directory: string;
        manifest: DeploymentPayloadManifest;
        selectedBuildId: string;
        selectedManifestSha256: string;
    }>
> {
    if (!isRecord(expected)) throw new Error('Invalid independently expected payload selection.');
    const selection = Object.freeze({
        selectedBuildId: expected.selectedBuildId,
        selectedManifestSha256: expected.selectedManifestSha256,
        platform: expected.platform,
        architecture: expected.architecture,
    });
    if (
        typeof selection.selectedBuildId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(selection.selectedBuildId) ||
        typeof selection.selectedManifestSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(selection.selectedManifestSha256) ||
        (selection.platform !== 'win32' && selection.platform !== 'darwin' && selection.platform !== 'linux') ||
        (selection.architecture !== 'x64' && selection.architecture !== 'arm64')
    )
        throw new Error('Invalid independently expected payload selection.');
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory)
        throw new Error('Payload root must be an absolute canonical directory.');
    const inspect = io.lstat ?? ((name: string) => lstat(name, { bigint: true }));
    const resolve = io.realpath ?? realpath;
    const list = io.readdir ?? readdir;
    const linkTarget = io.readlink ?? readlink;
    const root = await inspect(directory);
    if (!root.isDirectory() || root.isSymbolicLink() || (await resolve(directory)) !== directory)
        throw new Error('Payload root must be a canonical non-link directory.');
    async function named(name: string, before: BigIntStats): Promise<void> {
        if (
            !payloadUnchanged(before, await inspect(name)) ||
            before.dev !== root.dev ||
            (!before.isSymbolicLink() && (await resolve(name)) !== name)
        )
            throw new Error('Payload path identity or metadata changed.');
    }
    async function read(name: string, before: BigIntStats): Promise<Buffer> {
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
            throw new Error('Payload evidence must be a regular one-link file.');
        await named(name, before);
        const bytes = await readRegularFile(name, {
            lstat: async (file) => {
                const observed = await inspect(file);
                if (!payloadUnchanged(before, observed)) throw new Error('Payload path identity or metadata changed.');
                return observed;
            },
            ...(io.open ? { open: io.open } : {}),
        });
        await named(name, before);
        return bytes;
    }
    const manifestName = path.join(directory, 'payload-manifest.json');
    const manifestBefore = await inspect(manifestName);
    if (manifestBefore.size > 16n * 1024n * 1024n) throw new Error('Payload manifest exceeds its byte bound.');
    async function readManifest() {
        const bytes = await read(manifestName, manifestBefore);
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        const identity = identifyDeploymentPayload(JSON.parse(text));
        if (
            !bytes.equals(Buffer.from(identity.canonicalManifest, 'utf8')) ||
            identity.selectedBuildId !== selection.selectedBuildId ||
            identity.selectedManifestSha256 !== selection.selectedManifestSha256 ||
            identity.manifest.platform !== selection.platform ||
            identity.manifest.architecture !== selection.architecture
        )
            throw new Error('Payload canonical manifest or independent selection disagrees.');
        return identity;
    }
    const identity = await readManifest();
    const inventory = new Map(identity.manifest.entries.map((entry) => [entry.path, entry]));
    const seen = new Set<string>();
    const directories = new Map<string, { metadata: BigIntStats; names: string[] }>();
    const links = new Map<string, { metadata: BigIntStats; target: string }>();
    async function walk(current: string, before: BigIntStats, prefix = ''): Promise<void> {
        await named(current, before);
        const names = (await list(current)).sort();
        if (names.length > inventory.size + 1 || new Set(names).size !== names.length)
            throw new Error('Payload enumeration changed.');
        directories.set(current, { metadata: before, names });
        for (const name of names) {
            if (prefix === '' && name === 'payload-manifest.json') continue;
            const relative = `${prefix}${name}`;
            const entry = inventory.get(relative);
            if (!entry || !isPortablePayloadRelativePath(name) || name.includes('/') || seen.has(relative))
                throw new Error('Unexpected, aliased or duplicate payload entry.');
            seen.add(relative);
            const full = path.join(current, name);
            const metadata = await inspect(full);
            await named(full, metadata);
            if (entry.type === 'symlink') {
                if (!metadata.isSymbolicLink() || (await linkTarget(full)) !== entry.target)
                    throw new Error('Payload link type or target changed.');
                links.set(full, { metadata, target: entry.target });
                continue;
            }
            if (
                metadata.isSymbolicLink() ||
                (entry.type === 'directory' ? !metadata.isDirectory() : !metadata.isFile()) ||
                (selection.platform !== 'win32' && Number(metadata.mode & 0o111n) !== entry.executableBits)
            )
                throw new Error('Payload entry type or executable bits changed.');
            if (entry.type === 'directory') await walk(full, metadata, `${relative}/`);
            else if (!matches(await read(full, metadata), entry))
                throw new Error('Payload file length or digest changed.');
        }
        await named(current, before);
    }
    await walk(directory, root);
    if (seen.size !== inventory.size) throw new Error('Missing payload entries.');
    for (const [name, observed] of directories) {
        const names = (await list(name)).sort();
        if (names.length !== observed.names.length || names.some((part, index) => part !== observed.names[index]))
            throw new Error('Payload directory enumeration changed.');
        await named(name, observed.metadata);
    }
    for (const [name, observed] of links) {
        if ((await linkTarget(name)) !== observed.target) throw new Error('Payload link target changed.');
        await named(name, observed.metadata);
    }
    await named(manifestName, manifestBefore);
    await named(directory, root);
    return Object.freeze({
        directory,
        manifest: identity.manifest,
        selectedBuildId: identity.selectedBuildId,
        selectedManifestSha256: identity.selectedManifestSha256,
    });
}
