import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { readRegularFile } from '../../adapters/file-evidence.ts';
import type { PluginHost } from '../../domains/host-management.ts';
import { errorCode } from '../../shared/errors.ts';
import { type HostUserIntent, parseHostUserIntent } from '../user-intent.ts';

export async function readHostUserIntent(host: PluginHost, configRoot: string): Promise<HostUserIntent> {
    try {
        const file = path.join(configRoot, host === 'codex' ? 'config.toml' : 'settings.json');
        const identity = await lstat(file);
        if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1 || identity.size > 1024 * 1024)
            throw new Error();
        return parseHostUserIntent(host, (await readRegularFile(file)).toString('utf8'));
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return parseHostUserIntent(host, host === 'codex' ? '' : '{}');
        throw new Error('invalid-user-settings');
    }
}
