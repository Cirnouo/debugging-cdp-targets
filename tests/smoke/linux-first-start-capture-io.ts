import { open, realpath, stat } from 'node:fs/promises';
import type { CaptureCost, CaptureStatus } from './linux-first-start-capture-record.ts';

export interface CaptureFileHandle {
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
}
export type CaptureOpener = (file: string, flags: 'r') => Promise<CaptureFileHandle>;
export interface CaptureIdentity {
    dev: bigint;
    ino: bigint;
}
export interface CaptureIo {
    open?: CaptureOpener;
    stat?: (file: string) => Promise<CaptureIdentity>;
    realpath?: (file: string) => Promise<string>;
}
export interface CaptureBudget extends CaptureCost {
    fileLimit: number;
    metadataLimit: number;
}
export interface CaptureRead {
    bytes: number;
    text?: string;
    status: CaptureStatus;
}
export function createCaptureBudget(fileLimit: number, metadataLimit: number): CaptureBudget {
    return {
        fileLimit,
        metadataLimit,
        attempts: 0,
        opens: 0,
        readCalls: 0,
        closes: 0,
        bytes: 0,
        metadata: 0,
        completed: 0,
        pending: 0,
        handles: 0,
        settled: true,
    };
}
export function captureCost(budget: CaptureBudget): CaptureCost {
    const { fileLimit: _file, metadataLimit: _metadata, ...cost } = budget;
    return { ...cost, settled: budget.pending === 0 && budget.handles === 0 && budget.completed === budget.attempts };
}
function failure(error: unknown): CaptureStatus {
    try {
        const code: unknown =
            error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
        return code === 'ENOENT' || code === 'ESRCH'
            ? 'missing'
            : code === 'EPERM' || code === 'EACCES'
              ? 'permission'
              : 'read-failed';
    } catch {
        return 'read-failed';
    }
}
/** The close reservation belongs to the attempt before open admission; it survives deadlines. */
export async function readFirstStartFile(
    file: string,
    admitted: () => boolean,
    budget: CaptureBudget,
    opener: CaptureOpener = open,
): Promise<CaptureRead> {
    if (!admitted() || budget.attempts >= budget.fileLimit || budget.pending || budget.handles)
        return { bytes: 0, status: 'incomplete' };
    budget.attempts++;
    budget.settled = false;
    let handle: CaptureFileHandle | undefined;
    let bytes = 0;
    let result: CaptureRead = { bytes, status: 'incomplete' };
    try {
        budget.opens++;
        budget.pending++;
        try {
            handle = await opener(file, 'r');
        } finally {
            budget.pending--;
        }
        budget.handles++;
        const buffer = Buffer.alloc(4096);
        let calls = 0;
        while (admitted() && calls < 8 && bytes < 4096) {
            budget.readCalls++;
            calls++;
            budget.pending++;
            let count: number;
            try {
                count = (await handle.read(buffer, bytes, 4096 - bytes, bytes)).bytesRead;
            } finally {
                budget.pending--;
            }
            if (!Number.isSafeInteger(count) || count < 0 || count > 4096 - bytes) {
                result = { bytes, status: 'read-failed' };
                break;
            }
            bytes += count;
            budget.bytes += count;
            result = { bytes, status: bytes === 4096 ? 'overlong' : 'incomplete' };
            if (!admitted()) break;
            if (count === 0) {
                const text = buffer.toString('utf8', 0, bytes);
                result =
                    Buffer.byteLength(text) === bytes
                        ? { bytes, text, status: 'complete' }
                        : { bytes, status: 'read-failed' };
                break;
            }
        }
    } catch (error) {
        result = { bytes, status: failure(error) };
    } finally {
        if (handle) {
            budget.closes++;
            budget.pending++;
            try {
                await handle.close();
            } catch {
                result = { bytes, status: 'read-failed' };
            } finally {
                budget.pending--;
                budget.handles--;
            }
        }
        budget.completed++;
        budget.settled = budget.pending === 0 && budget.handles === 0 && budget.completed === budget.attempts;
    }
    return result;
}
export async function captureMetadata<T>(
    admitted: () => boolean,
    budget: CaptureBudget,
    operation: () => Promise<T>,
): Promise<T | undefined> {
    if (!admitted() || budget.metadata >= budget.metadataLimit || budget.pending || budget.handles) return;
    budget.metadata++;
    budget.pending++;
    try {
        const result = await operation();
        return admitted() ? result : undefined;
    } catch {
        return;
    } finally {
        budget.pending--;
    }
}
export function captureNativeIo(io: CaptureIo = {}): Required<CaptureIo> {
    return {
        open: io.open ?? open,
        realpath: io.realpath ?? realpath,
        stat:
            io.stat ??
            (async (file) => {
                const identity = await stat(file, { bigint: true });
                return { dev: identity.dev, ino: identity.ino };
            }),
    };
}
