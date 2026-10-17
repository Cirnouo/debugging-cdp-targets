import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Independent ZIP fixture: empty stored entries, with explicit central-directory kinds.
function archive(entries: { name: string; kind?: number }[]) {
    const locals: Buffer[] = [],
        central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(name.length, 26);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50);
        record.writeUInt16LE(0x0314, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt16LE(name.length, 28);
        record.writeUInt32LE(((entry.kind ?? 0x8000) * 65536) >>> 0, 38);
        record.writeUInt32LE(offset, 42);
        locals.push(local, name);
        central.push(record, name);
        offset += local.length + name.length;
    }
    const directory = Buffer.concat(central),
        end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

test('native App ZIP extraction rejects traversal, aliases, duplicate destinations and nonregular kinds before writing', {
    skip: process.platform !== 'win32',
}, async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-app-zip-')));
    try {
        const script = fileURLToPath(new URL('../tooling/extract-app-zip.ps1', import.meta.url));
        const cases = [
            [{ name: 'a/../inside' }],
            [{ name: '../outside' }],
            [{ name: '/absolute' }],
            [{ name: 'C:/absolute' }],
            [{ name: 'a\\b' }],
            [{ name: 'a' }, { name: 'A' }],
            [{ name: 'dir/', kind: 0x4000 }, { name: 'DIR' }],
            [{ name: 'link', kind: 0xa000 }],
            [{ name: 'device', kind: 0x2000 }],
            [{ name: 'alias.' }],
            [{ name: 'alias ' }],
        ];
        for (const [index, entries] of cases.entries()) {
            const input = path.join(root, `input-${index}.zip`),
                output = path.join(root, `output-${index}`);
            await writeFile(input, archive(entries));
            const result = spawnSync(
                'pwsh',
                ['-NoProfile', '-File', script, '-Archive', input, '-Destination', output],
                { encoding: 'utf8', windowsHide: true },
            );
            assert.notEqual(result.status, 0, `unsafe ZIP fixture ${index} was accepted`);
            await assert.rejects(lstat(output), { code: 'ENOENT' });
        }
        const input = path.join(root, 'valid.zip'),
            output = path.join(root, 'valid');
        await writeFile(input, archive([{ name: 'nested/', kind: 0x4000 }, { name: 'nested/file' }]));
        const result = spawnSync('pwsh', ['-NoProfile', '-File', script, '-Archive', input, '-Destination', output], {
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal((await readFile(path.join(output, 'nested/file'))).length, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
