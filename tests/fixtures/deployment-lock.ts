import { closeSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAppAdvisoryLock } from '../../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../../src/domains/app-release.ts';
import { isRecord } from '../../src/shared/errors.ts';

const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory) || !process.send) throw new Error('Missing owned lock fixture.');
const tryLock = await loadAppAdvisoryLock(
    parseAppNativeEvidence(
        JSON.parse(await readFile(new URL('../../tooling/app-native-release.json', import.meta.url), 'utf8')),
    ),
);
const held = new Map<number, number>();
process.on('message', (message: unknown) => {
    if (!isRecord(message) || !Number.isSafeInteger(message.id) || typeof message.id !== 'number')
        throw new Error('Malformed fixture command.');
    if (
        message.type === 'acquire' &&
        (message.file === 'operation.lock' || message.file === 'use.lock') &&
        typeof message.shared === 'boolean'
    ) {
        const fd = openSync(path.join(directory, message.file), message.shared ? 'r' : 'r+');
        try {
            const locked = tryLock(fd, { shared: message.shared });
            if (locked) held.set(message.id, fd);
            else closeSync(fd);
            process.send?.({ id: message.id, locked });
        } catch (error) {
            closeSync(fd);
            throw error;
        }
    } else if (message.type === 'release' && typeof message.lease === 'number') {
        const fd = held.get(message.lease);
        if (fd === undefined) throw new Error('Unknown fixture lease.');
        closeSync(fd);
        held.delete(message.lease);
        process.send?.({ id: message.id, released: true });
    } else throw new Error('Malformed fixture command.');
});
process.on('disconnect', () => {
    for (const fd of held.values()) closeSync(fd);
    held.clear();
});
process.send({ ready: true });
