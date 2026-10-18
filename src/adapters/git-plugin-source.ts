import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    type PluginHost,
    parseStablePluginRecord,
    pluginSourcePath,
    type StablePluginRecord,
} from '../domains/host-management.ts';
import { verifyPluginPayload } from '../host-plugins/payload-integrity.ts';
import { isRecord } from '../shared/errors.ts';
import { verifyCatalog } from './native-host-plugins.ts';

type GitRun = (args: string[], cwd: string, env: Record<string, string | undefined>) => Promise<Buffer>;

const gitRun: GitRun = async (args, cwd, env) => {
    try {
        return (
            await promisify(execFile)('git', args, {
                cwd,
                env,
                windowsHide: true,
                shell: false,
                encoding: 'buffer',
                timeout: 60_000,
                maxBuffer: 8 * 1024 * 1024,
            })
        ).stdout;
    } catch {
        throw new Error('git-source-read-failed');
    }
};

/** Fetch latest catalog B and its immutable payload A separately. Never run payload code or checkout hooks. */
export async function readGitPluginSource(record: StablePluginRecord, host: PluginHost, io: { run?: GitRun } = {}) {
    const validated = parseStablePluginRecord(record);
    if (!validated) throw new Error('invalid-stable-plugin-record');
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-reviewed-plugin-'));
    try {
        const empty = path.join(root, 'empty');
        await mkdir(empty);
        const env = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
        );
        env.GIT_CONFIG_NOSYSTEM = '1';
        env.GIT_CONFIG_GLOBAL = path.join(empty, 'absent-config');
        env.GIT_TERMINAL_PROMPT = '0';
        const invoke = (args: string[]) =>
            (io.run ?? gitRun)(['-c', `core.hooksPath=${empty}`, '-c', 'core.autocrlf=false', ...args], root, env);
        await invoke(['init', `--template=${empty}`, '.']);
        await invoke(['fetch', '--no-tags', '--depth=1', '--filter=blob:none', '--', validated.source.url, 'HEAD']);
        const catalogPath = host === 'codex' ? '.agents/plugins/marketplace.json' : '.claude-plugin/marketplace.json';
        const raw = await invoke(['show', `FETCH_HEAD:${catalogPath}`]);
        const catalog: unknown = JSON.parse(raw.toString('utf8'));
        if (!isRecord(catalog)) throw new Error('invalid-marketplace-catalog');
        verifyCatalog(validated, host, catalog);
        const peer = host === 'codex' ? 'claude' : 'codex';
        const peerPath = peer === 'codex' ? '.agents/plugins/marketplace.json' : '.claude-plugin/marketplace.json';
        const peerCatalog: unknown = JSON.parse((await invoke(['show', `FETCH_HEAD:${peerPath}`])).toString('utf8'));
        if (!isRecord(peerCatalog)) throw new Error('invalid-marketplace-catalog');
        verifyCatalog(validated, peer, peerCatalog);
        await invoke([
            'fetch',
            '--no-tags',
            '--depth=1',
            '--filter=blob:none',
            '--',
            validated.source.url,
            validated.source.sha,
        ]);
        const tree = (
            await invoke(['ls-tree', '-rz', '--full-tree', validated.source.sha, '--', pluginSourcePath(host)])
        ).toString('utf8');
        const files = new Map<string, Buffer>();
        const prefixes = new Map<string, { spelling: string; directory: boolean }>();
        let total = 0;
        for (const line of tree.split('\0').filter(Boolean)) {
            const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
            const fullPath = match?.[3];
            const prefix = `${pluginSourcePath(host)}/`;
            if (!match || !fullPath?.startsWith(prefix)) throw new Error('invalid-git-source-tree');
            const relative = fullPath.slice(prefix.length);
            if (
                !relative ||
                relative.split('/')[0]?.toLowerCase() === '.in_use' ||
                relative
                    .split('/')
                    .some((part) => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part)) ||
                files.size >= 512
            )
                throw new Error('invalid-git-source-path');
            const parts = relative.split('/');
            for (let count = 1; count <= parts.length; count++) {
                const spelling = parts.slice(0, count).join('/');
                const directory = count < parts.length;
                const folded = spelling.toLowerCase();
                const prior = prefixes.get(folded);
                if (prior && (prior.spelling !== spelling || prior.directory !== directory || !directory))
                    throw new Error('invalid-git-source-path');
                prefixes.set(folded, { spelling, directory });
            }
            const bytes = await invoke(['cat-file', 'blob', requiredObjectId(match[2])]);
            total += bytes.length;
            if (total > 16 * 1024 * 1024) throw new Error('oversized-git-source');
            files.set(relative, bytes);
        }
        verifyPluginPayload(host, validated.version, files, files, false);
        return { catalog, files };
    } finally {
        await rm(root, { recursive: true });
    }
}

function requiredObjectId(value: string | undefined): string {
    if (!value || !/^[a-f0-9]{40}$/.test(value)) throw new Error('invalid-git-source-object');
    return value;
}
