import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type NativeResourceReadyRole = 'root' | 'middle' | 'late';
export interface NativeResourceReadyIo {
    writeFile(file: string, data: string, options?: { flag: 'wx'; mode: number }): Promise<void>;
    rename(source: string, destination: string): Promise<void>;
}
const fileIo: NativeResourceReadyIo = { writeFile, rename };

export async function publishNativeResourcePid(
    directory: string,
    role: NativeResourceReadyRole,
    pid: number,
    io: NativeResourceReadyIo = fileIo,
) {
    const temporary = path.join(directory, `.${role}-ready-${randomUUID()}.tmp`);
    // writeFile settles after closing its handle. Failed private files remain owned by directory cleanup.
    await io.writeFile(temporary, String(pid), { flag: 'wx', mode: 0o600 });
    await io.rename(temporary, path.join(directory, `${role}-ready`));
}
