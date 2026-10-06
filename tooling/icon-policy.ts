import { inflateSync } from 'node:zlib';
import { isRecord } from '../src/shared/errors.ts';
import { PLUGIN_HOSTS, SHARED_PACKAGING_ROOT } from './host-policy.ts';

export const SHARED_ASSET_FILES = Object.freeze([
    'README.md',
    'generation.json',
    'icon-source.png',
    'icon-light.png',
    'icon-dark.png',
    'icon.png',
]);

const approvedPngPaths = new Set([
    ...SHARED_ASSET_FILES.filter((file) => file.endsWith('.png')).map(
        (file) => `${SHARED_PACKAGING_ROOT}/assets/${file}`,
    ),
    ...PLUGIN_HOSTS.flatMap((host) => host.assets.map((file) => `${host.payloadRoot}/assets/${file}`)),
]);

export function isApprovedIconPath(file: string) {
    return approvedPngPaths.has(file);
}

function crc32(bytes: Buffer) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// The approved artwork is noninterlaced 8-bit RGBA. Validate its encoded stream
// without executing content or adding a general-purpose image decoder.
export function validateIconPng(file: string, bytes: Buffer): string[] {
    try {
        if (
            bytes.length > 5 * 1024 * 1024 ||
            bytes.length < 57 ||
            !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
            throw new Error('invalid signature or size');
        let offset = 8;
        let width = 0;
        let height = 0;
        let ended = false;
        let credentials = false;
        const data: Buffer[] = [];
        while (offset < bytes.length) {
            if (bytes.length - offset < 12) throw new Error('truncated chunk');
            const length = bytes.readUInt32BE(offset);
            const end = offset + length + 12;
            if (end > bytes.length) throw new Error('truncated chunk data');
            const type = bytes.toString('latin1', offset + 4, offset + 8);
            if (
                !/^[A-Za-z]{4}$/.test(type) ||
                /[a-z]/.test(type[2] ?? '') ||
                crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
            )
                throw new Error('invalid chunk type or CRC');
            if (offset === 8 && type !== 'IHDR') throw new Error('missing initial IHDR');
            if (type === 'IHDR') {
                if (offset !== 8 || length !== 13) throw new Error('invalid IHDR');
                width = bytes.readUInt32BE(offset + 8);
                height = bytes.readUInt32BE(offset + 12);
                if (
                    width !== height ||
                    width < 48 ||
                    width > 4096 ||
                    !bytes.subarray(offset + 16, offset + 21).equals(Buffer.from([8, 6, 0, 0, 0]))
                )
                    throw new Error('requires square 48–4096 noninterlaced 8-bit RGBA');
            } else if (type === 'IDAT') {
                data.push(bytes.subarray(offset + 8, end - 4));
            } else if (type === 'IEND') {
                if (length !== 0 || data.length === 0 || end !== bytes.length) throw new Error('invalid final IEND');
                ended = true;
            } else if (type === 'caBX' && /(?:^|\/)icon-source\.png$/.test(file) && !credentials && !data.length) {
                // Preserve the source's generated Content Credentials; delivery
                // images contain only IHDR, consecutive IDAT and IEND chunks.
                credentials = true;
            } else throw new Error('chunk outside approved static artwork profile');
            offset = end;
        }
        if (!ended) throw new Error('missing IEND');
        const stride = width * 4 + 1;
        const expected = stride * height;
        const compressed = Buffer.concat(data);
        const decoded: unknown = inflateSync(compressed, { maxOutputLength: expected, info: true });
        if (
            !isRecord(decoded) ||
            !Buffer.isBuffer(decoded.buffer) ||
            !isRecord(decoded.engine) ||
            decoded.buffer.length !== expected ||
            decoded.engine.bytesWritten !== compressed.length
        )
            throw new Error('invalid pixel stream length');
        for (let row = 0; row < height; row++)
            if ((decoded.buffer[row * stride] ?? 255) > 4) throw new Error('invalid row filter');
        return [];
    } catch (error) {
        return [`${file}: invalid icon PNG (${error instanceof Error ? error.message : String(error)}).`];
    }
}
