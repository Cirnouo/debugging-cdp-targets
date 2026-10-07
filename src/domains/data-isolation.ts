import { isRecord } from '../shared/errors.ts';

export type DataDirectoryCleanup = 'retain' | 'delete-on-release';
export type DataDirectorySelection =
    | { kind: 'existing'; path: string }
    | { kind: 'new'; parent: string; name?: string };
export type DataIsolation =
    | { mode: 'none' }
    | { mode: 'data-dir'; directory: DataDirectorySelection; cleanup: DataDirectoryCleanup };
export type DataDirectoryState = 'held' | 'retained' | 'deleted' | 'cleanup-failed';
export interface DataDirectoryEvidence {
    readonly path: string;
    readonly cleanup: DataDirectoryCleanup;
    readonly state: DataDirectoryState;
    readonly nonempty?: boolean;
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function validString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

export function parseDataIsolation(value: unknown): DataIsolation {
    if (!isRecord(value)) throw new Error('An explicit isolation selection is required.');
    if (value.mode === 'none' && keys(value, ['mode'])) return { mode: 'none' };
    if (
        value.mode !== 'data-dir' ||
        !keys(value, ['mode', 'directory', 'cleanup']) ||
        !isRecord(value.directory) ||
        (value.cleanup !== 'retain' && value.cleanup !== 'delete-on-release')
    )
        throw new Error('Invalid data directory isolation selection.');
    const directory = value.directory;
    let selection: DataDirectorySelection;
    if (directory.kind === 'existing' && keys(directory, ['kind', 'path']) && validString(directory.path)) {
        selection = { kind: 'existing', path: directory.path };
    } else if (
        directory.kind === 'new' &&
        keys(directory, ['kind', 'parent', 'name']) &&
        validString(directory.parent)
    ) {
        if (
            'name' in directory &&
            (!validString(directory.name) ||
                directory.name === '.' ||
                directory.name === '..' ||
                /[/\\:]/.test(directory.name) ||
                /[.\s]$/.test(directory.name))
        )
            throw new Error('The new directory name must be a safe leaf name.');
        selection = {
            kind: 'new',
            parent: directory.parent,
            ...('name' in directory ? { name: String(directory.name) } : {}),
        };
    } else throw new Error('Invalid data directory operation.');
    return { mode: 'data-dir', directory: selection, cleanup: value.cleanup };
}
