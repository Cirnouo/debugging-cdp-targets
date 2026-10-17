import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Called by the tiny synchronous bootstrap before any main-module import or await. */
export function createAppChromiumStorage() {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'dct-chromium-'));
    const userData = path.join(directory, 'user-data');
    const sessionData = path.join(directory, 'session-data');
    try {
        mkdirSync(userData, { mode: 0o700 });
        mkdirSync(sessionData, { mode: 0o700 });
    } catch (error) {
        try {
            rmSync(directory, { recursive: true, force: true });
        } catch {
            // Leave only this process's OS-temp residue if the OS still holds it.
        }
        throw error;
    }
    return Object.freeze({
        directory,
        userData,
        sessionData,
        async cleanup(): Promise<boolean> {
            try {
                await rm(directory, { recursive: true, force: true });
                return true;
            } catch {
                // Cache deletion must not block normal owned target cleanup or trigger process killing.
                return false;
            }
        },
    });
}
