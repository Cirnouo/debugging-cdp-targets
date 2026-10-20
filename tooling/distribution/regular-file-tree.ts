import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readRegularFile } from '../../src/adapters/file-evidence.ts';

export function compareDistributionTrees(source: Map<string, Buffer>, installed: Map<string, Buffer>) {
    const errors = [];
    for (const [file, data] of source) {
        const installedData = installed.get(file);
        if (!installedData) errors.push(`Missing installed file: ${file}`);
        else if (!data.equals(installedData)) errors.push(`Changed installed file: ${file}`);
    }
    for (const file of installed.keys()) if (!source.has(file)) errors.push(`Extra installed file: ${file}`);
    return errors;
}

export async function readDistributionTree(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
    const owned = path.resolve(directory);
    if (!(await lstat(owned)).isDirectory() || path.relative(owned, await realpath(owned)) !== '')
        throw new Error('Plugin directories must be regular and must not contain linked paths.');
    const files = new Map<string, Buffer>();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Plugin may not contain symlinks: ${relative}`);
        if (entry.isDirectory()) {
            const nested = await readDistributionTree(path.join(directory, entry.name), relative);
            if (!nested.size) throw new Error(`Unexpected empty Plugin directory: ${relative}`);
            for (const [file, data] of nested) files.set(file, data);
        } else if (entry.isFile()) files.set(relative, await readRegularFile(path.join(directory, entry.name)));
        else throw new Error(`Unexpected Plugin entry: ${relative}`);
    }
    return files;
}
