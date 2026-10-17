import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AppReleaseFile } from '../domains/app-release.ts';
import { isOfficialRelativePath } from '../shared/official-package.ts';
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
        if (!isOfficialRelativePath(file.path) || expected.has(file.path))
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
