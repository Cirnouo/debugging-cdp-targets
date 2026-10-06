import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { assembleCodexPayload, generateRuntimeFiles } from '../tooling/build-plugin.ts';
import { validateHostManifest } from '../tooling/distribution-audit.ts';
import { CLAUDE_CODE_HOST, CODEX_HOST } from '../tooling/host-policy.ts';
import { validateIconPng } from '../tooling/icon-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function pngChunk(type: string, data: Buffer) {
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length);
    chunk.write(type, 4, 'ascii');
    data.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    return chunk;
}

function highBitChunk(type: string, bytes: Buffer) {
    const mutated = Buffer.from(bytes);
    let offset = 8;
    while (mutated.toString('latin1', offset + 4, offset + 8) !== type) offset += mutated.readUInt32BE(offset) + 12;
    const end = offset + mutated.readUInt32BE(offset) + 12;
    for (let index = offset + 4; index < offset + 8; index++) mutated[index] = (mutated[index] ?? 0) | 0x80;
    let crc = 0xffffffff;
    for (const byte of mutated.subarray(offset + 4, end - 4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    mutated.writeUInt32BE((crc ^ 0xffffffff) >>> 0, end - 4);
    return mutated;
}

function png(width: number, height: number, pixels = Buffer.alloc((width * 4 + 1) * height)) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(pixels)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

for (const type of ['IHDR', 'IDAT', 'IEND']) {
    test(`PNG validation rejects CRC-valid high-bit bytes masquerading as ${type}`, () => {
        assert.ok(validateIconPng('icon.png', highBitChunk(type, png(48, 48))).length);
    });
}

test('PNG validation checks independent dimensions, checksums, complete streams and row filters', () => {
    assert.deepEqual(validateIconPng('icon.png', png(48, 48)), []);
    for (const [width, height] of [
        [47, 47],
        [48, 49],
        [4097, 4097],
    ]) {
        assert.ok(validateIconPng('icon.png', png(width ?? 0, height ?? 0, Buffer.alloc(0))).length);
    }
    const valid = png(48, 48);
    for (const type of ['acTL', 'tRNS', 'zzZZ']) {
        const competingChunk = Buffer.concat([
            valid.subarray(0, 33),
            pngChunk(type, Buffer.alloc(0)),
            valid.subarray(33),
        ]);
        assert.ok(validateIconPng('icon.png', competingChunk).length);
    }
    const badCrc = Buffer.from(valid);
    badCrc[32] = (badCrc[32] ?? 0) ^ 1;
    const badFilter = Buffer.alloc(193 * 48);
    badFilter[193] = 5;
    for (const invalid of [
        badCrc,
        valid.subarray(0, -12),
        Buffer.concat([valid, Buffer.from([0])]),
        png(48, 48, Buffer.alloc(10)),
        png(48, 48, Buffer.alloc(193 * 48 + 1)),
        png(48, 48, badFilter),
    ])
        assert.ok(validateIconPng('icon.png', invalid).length);
    const compressedTrailing = Buffer.concat([
        valid.subarray(0, 33),
        pngChunk('IDAT', Buffer.concat([deflateSync(Buffer.alloc(193 * 48)), Buffer.from([0])])),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
    assert.ok(validateIconPng('icon.png', compressedTrailing).length);
});

test('listing manifests require exact host icon paths and reject missing or competing fields', async () => {
    for (const host of [CODEX_HOST, CLAUDE_CODE_HOST]) {
        const manifest = JSON.parse(await readFile(path.join(root, host.inputRoot, host.manifest), 'utf8'));
        const fields = host === CODEX_HOST ? manifest.interface : manifest;
        const icons =
            host === CODEX_HOST
                ? {
                      logo: './assets/icon-light.png',
                      logoDark: './assets/icon-dark.png',
                      composerIcon: './assets/icon-light.png',
                      composerIconDark: './assets/icon-dark.png',
                  }
                : { icon: './assets/icon.png' };
        Object.assign(fields, icons);
        assert.deepEqual(validateHostManifest(manifest, host), []);
        for (const key of Object.keys(icons)) {
            const original = fields[key];
            for (const invalid of [undefined, '../icon.png', './assets/unknown.png', 1]) {
                fields[key] = invalid;
                assert.ok(validateHostManifest(manifest, host).length);
            }
            fields[key] = original;
        }
        fields.unknownIcon = './assets/icon.png';
        assert.ok(validateHostManifest(manifest, host).length);
    }
});

test('assembly copies only approved icons and rejects missing, unexpected and malformed PNG inputs', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'dct-icons-'));
    try {
        await cp(path.join(root, 'packaging'), path.join(fixture, 'packaging'), { recursive: true });
        await cp(path.join(root, 'LICENSE'), path.join(fixture, 'LICENSE'));
        const runtime = await generateRuntimeFiles();
        const payload = await assembleCodexPayload(runtime, fixture);
        assert.deepEqual([...payload.keys()].filter((file) => file.startsWith('assets/')).sort(), [
            'assets/README.md',
            'assets/icon-dark.png',
            'assets/icon-light.png',
        ]);
        const icon = path.join(fixture, 'packaging/shared/assets/icon-light.png');
        const bytes = await readFile(icon);
        assert.ok(payload.get('assets/icon-light.png')?.equals(bytes));
        await rm(icon);
        await assert.rejects(assembleCodexPayload(runtime, fixture), /Missing|ENOENT/);
        await writeFile(icon, bytes);
        const extra = path.join(fixture, 'packaging/shared/assets/unknown.png');
        await writeFile(extra, bytes);
        await assert.rejects(assembleCodexPayload(runtime, fixture), /Unexpected/);
        await rm(extra);
        for (const invalid of [bytes.subarray(0, 40), Buffer.alloc(5 * 1024 * 1024 + 1), Buffer.from('not a PNG')]) {
            await writeFile(icon, invalid);
            await assert.rejects(assembleCodexPayload(runtime, fixture), /PNG|icon/i);
        }
        const nonSquare = Buffer.from(bytes);
        nonSquare.writeUInt32BE(1000, 20);
        await writeFile(icon, nonSquare);
        await assert.rejects(assembleCodexPayload(runtime, fixture), /PNG|icon/i);
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});
