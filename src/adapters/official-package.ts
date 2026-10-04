import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
    type OfficialReleaseEvidence,
    parseOfficialReleaseEvidence,
    validateOfficialManifest,
} from '../shared/official-package.ts';
import { readRegularFile } from './file-evidence.ts';

/** Return only the independently verified release bytes; never follow package links. */
export async function verifyOfficialPackage(
    directory: string,
    input: OfficialReleaseEvidence,
    options: { pnpmInstalled?: boolean } = {},
): Promise<Map<string, Buffer>> {
    const evidence = parseOfficialReleaseEvidence(input);
    const root = path.resolve(directory);
    const rootStat = await lstat(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
        throw new Error('Official package root must be a directory without links.');
    const canonical = await realpath(root);
    if (path.relative(root, canonical) !== '') throw new Error('Official package root has a linked or aliased parent.');
    const expected = new Map(evidence.files.map((file) => [file.path, file]));
    const directories = new Set(
        evidence.files.flatMap((file) => {
            const parents = [];
            for (let parent = path.posix.dirname(file.path); parent !== '.'; parent = path.posix.dirname(parent))
                parents.push(parent);
            return parents;
        }),
    );
    const files = new Map<string, Buffer>();
    const shims = new Set(
        ['chrome-devtools-mcp', 'chrome-devtools'].flatMap((bin) =>
            ['', '.cmd', '.ps1'].map((suffix) => `node_modules/.bin/${bin}${suffix}`),
        ),
    );
    async function visit(current: string, prefix = '') {
        for (const name of await readdir(current)) {
            const relative = `${prefix}${name}`;
            const absolute = path.join(current, name);
            const stat = await lstat(absolute);
            if (stat.isSymbolicLink()) throw new Error(`Official package contains a link: ${relative}`);
            if (path.relative(canonical, await realpath(absolute)).replaceAll('\\', '/') !== relative)
                throw new Error(`Official package path escaped or changed: ${relative}`);
            if (stat.isDirectory()) {
                if (options.pnpmInstalled && ['node_modules', 'node_modules/.bin'].includes(relative)) {
                    await visit(absolute, `${relative}/`);
                    continue;
                }
                if (!directories.has(relative)) throw new Error(`Unexpected official package directory: ${relative}`);
                await visit(absolute, `${relative}/`);
            } else {
                if (!stat.isFile()) throw new Error(`Official package entry is not a regular file: ${relative}`);
                if (options.pnpmInstalled && shims.has(relative)) continue;
                const record = expected.get(relative);
                if (!record) throw new Error(`Unexpected official package file: ${relative}`);
                const bytes = await readRegularFile(absolute);
                if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256)
                    throw new Error(`Official package digest or length changed: ${relative}`);
                files.set(relative, bytes);
            }
        }
    }
    await visit(root);
    for (const file of expected.keys()) if (!files.has(file)) throw new Error(`Missing official package file: ${file}`);
    const manifest: unknown = JSON.parse(files.get('package.json')?.toString('utf8') ?? 'null');
    validateOfficialManifest(manifest, evidence);
    return files;
}
