import { execFile } from 'node:child_process';
import type { BigIntStats } from 'node:fs';
import { lstat, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    type DeploymentEntryPurpose,
    type DeploymentUnixRole,
    hasDeploymentUnixEntryPermissions,
    validateDeploymentNativeEntry,
    validateDeploymentUnixEntry,
} from '../domains/app-deployment.ts';
import { isRecord } from '../shared/errors.ts';

const helperDirectory = fileURLToPath(new URL('.', import.meta.url));
const windowsDirectory = process.env.SystemRoot;
const failure = () => new Error('Deployment native authority is unavailable or unsafe.');

function account(): string {
    if (!process.getuid || !process.geteuid) throw failure();
    const real = process.getuid();
    if (!Number.isSafeInteger(real) || real < 0 || real !== process.geteuid()) throw failure();
    return String(real);
}

async function snapshot(file: string): Promise<unknown> {
    let executable: string;
    let args: string[];
    let env: NodeJS.ProcessEnv;
    if (process.platform === 'win32') {
        if (!windowsDirectory || !/^[A-Za-z]:\\/.test(windowsDirectory) || /[\0\r\n]/.test(windowsDirectory))
            throw failure();
        executable = path.join(windowsDirectory, 'System32/WindowsPowerShell/v1.0/powershell.exe');
        args = [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-File',
            path.join(helperDirectory, 'windows-deployment-authority.ps1'),
            '-Path',
            file,
        ];
        env = { SystemRoot: windowsDirectory, WINDIR: windowsDirectory };
    } else if (process.platform === 'darwin') {
        executable = '/usr/bin/osascript';
        args = ['-l', 'JavaScript', path.join(helperDirectory, 'macos-deployment-authority.jxa'), file];
        env = { PATH: '/usr/bin:/bin', LANG: 'C' };
    } else throw failure();
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
            executable,
            args,
            {
                shell: false,
                windowsHide: true,
                cwd: helperDirectory,
                env,
                encoding: 'utf8',
                maxBuffer: 65536,
            },
            (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })),
        );
    });
    if (stderr || !stdout || Buffer.byteLength(stdout) > 65536) throw failure();
    return JSON.parse(stdout);
}

/** Concrete OS evidence for this enrolled root only. No JSON, role flag or environment grants writes. */
export async function openDeploymentNativeAuthority(directory: string, writing: boolean) {
    if (!['linux', 'win32', 'darwin'].includes(process.platform))
        throw new Error('Deployment native role is unsupported.');
    const root = await lstat(directory, { bigint: true });
    const role: DeploymentUnixRole =
        process.platform === 'linux' && directory === '/opt/debugging-cdp-targets' && root.uid === 0n
            ? 'system'
            : 'private';
    const initial = process.platform === 'win32' ? await snapshot(directory) : undefined;
    const ownerAccount =
        process.platform === 'win32' && isRecord(initial) && typeof initial.account === 'string'
            ? initial.account
            : process.platform === 'win32'
              ? ''
              : account();
    if (!ownerAccount) throw failure();

    function writer() {
        if (!writing) throw new Error('Deployment reader cannot acquire writer authority.');
        if (process.platform !== 'win32' && (account() !== ownerAccount || (role === 'system' && ownerAccount !== '0')))
            throw failure();
    }

    function documentReceipt(stats: BigIntStats) {
        if (process.platform !== 'linux') return;
        if (
            account() !== ownerAccount ||
            stats.dev !== root.dev ||
            !hasDeploymentUnixEntryPermissions(
                {
                    uid: String(stats.uid),
                    gid: String(stats.gid),
                    mode: Number(stats.mode & 0o7777n),
                    directory: stats.isDirectory(),
                },
                ownerAccount,
                role,
                'document',
                false,
            )
        )
            throw failure();
    }

    async function verifyEntry(
        file: string,
        stats: BigIntStats,
        purpose: DeploymentEntryPurpose,
        ancestor: boolean,
        documentRead: boolean,
    ) {
        if (documentRead) documentReceipt(stats);
        if (
            (!stats.isDirectory() && !stats.isFile()) ||
            stats.isSymbolicLink() ||
            (!ancestor && (purpose === 'directory') !== stats.isDirectory()) ||
            (!stats.isDirectory() && stats.nlink !== 1n) ||
            (!ancestor && stats.dev !== root.dev) ||
            (await realpath(file)) !== file
        )
            throw failure();
        if (process.platform === 'linux') {
            if (account() !== ownerAccount) throw failure();
            validateDeploymentUnixEntry(
                {
                    uid: String(stats.uid),
                    gid: String(stats.gid),
                    mode: Number(stats.mode & 0o7777n),
                    directory: stats.isDirectory(),
                },
                ownerAccount,
                role,
                purpose,
                ancestor,
            );
            // Linux UAPI magic.h. A mount spelling alone never establishes local storage.
            const volume = await statfs(file, { bigint: true });
            if (![0xef53n, 0x01021994n, 0x58465342n, 0x9123683en].includes(volume.type))
                throw new Error('Deployment filesystem is unsupported.');
        } else {
            const value = await snapshot(file);
            validateDeploymentNativeEntry(
                value,
                {
                    platform: process.platform === 'win32' ? 'win32' : 'darwin',
                    account: ownerAccount,
                    path: file,
                    device: String(stats.dev),
                    inode: String(stats.ino),
                    links: String(stats.nlink),
                    size: String(stats.isDirectory() ? 0 : stats.size),
                    directory: stats.isDirectory(),
                },
                ancestor,
            );
            if (process.platform === 'darwin' && account() !== ownerAccount) throw failure();
        }
        const after = await lstat(file, { bigint: true });
        if (documentRead && process.platform === 'linux') {
            function safeNamed(entry: BigIntStats) {
                documentReceipt(entry);
                if (
                    !entry.isFile() ||
                    entry.isSymbolicLink() ||
                    entry.nlink !== 1n ||
                    entry.dev !== root.dev ||
                    entry.dev !== stats.dev ||
                    entry.mode !== stats.mode ||
                    entry.uid !== stats.uid ||
                    entry.gid !== stats.gid
                )
                    throw failure();
            }
            function unchanged(first: BigIntStats, second: BigIntStats) {
                return (
                    first.dev === second.dev &&
                    first.ino === second.ino &&
                    first.nlink === second.nlink &&
                    first.size === second.size &&
                    first.ctimeNs === second.ctimeNs &&
                    first.mtimeNs === second.mtimeNs
                );
            }
            safeNamed(after);
            if ((await realpath(file)) !== file) throw failure();
            const final = await lstat(file, { bigint: true });
            safeNamed(final);
            if (!unchanged(stats, after) || !unchanged(after, final))
                throw new Error('Deployment document identity changed.');
            return;
        }
        if (
            after.dev !== stats.dev ||
            after.ino !== stats.ino ||
            after.mode !== stats.mode ||
            after.uid !== stats.uid ||
            after.gid !== stats.gid ||
            (!stats.isDirectory() &&
                (after.nlink !== stats.nlink ||
                    after.size !== stats.size ||
                    after.ctimeNs !== stats.ctimeNs ||
                    after.mtimeNs !== stats.mtimeNs)) ||
            (await realpath(file)) !== file
        )
            throw failure();
    }

    function entry(file: string, stats: BigIntStats, purpose: DeploymentEntryPurpose, ancestor = false) {
        return verifyEntry(file, stats, purpose, ancestor, false);
    }

    function document(file: string, stats: BigIntStats) {
        return verifyEntry(file, stats, 'document', false, true);
    }

    async function ancestors() {
        const names: string[] = [];
        for (let current = path.dirname(directory); ; current = path.dirname(current)) {
            names.push(current);
            if (current === path.dirname(current)) break;
        }
        for (const name of names.reverse()) await entry(name, await lstat(name, { bigint: true }), 'directory', true);
    }
    await ancestors();
    await entry(directory, root, 'directory');
    if (writing) writer();
    return Object.freeze({ role, entry, documentReceipt, document, ancestors, writer });
}
