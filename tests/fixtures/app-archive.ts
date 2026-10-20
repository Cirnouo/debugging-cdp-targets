import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { isRecord } from '../../src/shared/errors.ts';

// A small stored ZIP made only from inert owned bytes, never a vendor/native binary.
export function storedAppZip(entries: readonly { name: string; content: string; mode?: number }[]) {
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = Buffer.from(entry.content);
        let crc = 0xffffffff;
        for (const value of data) {
            crc ^= value;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50);
        header.writeUInt16LE(20, 4);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(name.length, 26);
        local.push(header, name, data);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50);
        record.writeUInt16LE(0x0314, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt32LE(crc, 16);
        record.writeUInt32LE(data.length, 20);
        record.writeUInt32LE(data.length, 24);
        record.writeUInt16LE(name.length, 28);
        record.writeUInt32LE(((entry.mode ?? (entry.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0, 38);
        record.writeUInt32LE(offset, 42);
        central.push(record, name);
        offset += header.length + name.length + data.length;
    }
    const table = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(table.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, table, end]);
}

export function guardAppArchiveExtraction(allowed: ReadonlySet<string>) {
    const descriptor = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'spawn');
    assert.ok(descriptor);
    Object.defineProperty(ChildProcess.prototype, 'spawn', {
        ...descriptor,
        value: function (this: ChildProcess, options: unknown) {
            if (
                !isRecord(options) ||
                options.file !== 'pwsh' ||
                !Array.isArray(options.args) ||
                !allowed.has(JSON.stringify(options.args))
            )
                throw new Error(
                    'External execution blocked before spawn: only the exact owned file-only ZIP fixture is allowed.',
                );
            return Reflect.apply(descriptor.value, this, [options]);
        },
    });
    return () => Object.defineProperty(ChildProcess.prototype, 'spawn', descriptor);
}
