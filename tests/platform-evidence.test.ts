import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveUnixExecutable, unixSnapshot, validateProcessIdentity } from '../src/adapters/platform-process.ts';
import { errorDetails } from '../src/shared/errors.ts';

test('Linux creation evidence preserves kernel tick precision instead of the rounded ps display', async () => {
    const calls: string[] = [];
    const evidence = await unixSnapshot(42, 9222, {
        platform: 'linux',
        currentUser: () => 7,
        readlink: async () => process.execPath,
        readText: async (file) => {
            calls.push(file);
            if (file === '/proc/stat') return 'cpu 1 2 3\nbtime 0\n';
            assert.equal(file, '/proc/42/stat');
            return '42 (a name ) with spaces) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 100050 20\n';
        },
        run: async (executable) => {
            if (executable === 'getconf') return { code: 0, stdout: '100\n', stderr: '' };
            if (executable === 'ps') return { code: 0, stdout: '42 1 7 Thu Jan  1 00:16:40 1970 chrome\n', stderr: '' };
            assert.equal(executable, 'lsof');
            return { code: 0, stdout: 'p42\nn127.0.0.1:9222\n', stderr: '' };
        },
    });
    assert.ok(evidence.root.exists);
    assert.equal(evidence.root.startedAtUtc, '1970-01-01T00:16:40.500Z');
    assert.deepEqual(calls.sort(), ['/proc/42/stat', '/proc/stat']);
    const target = {
        executablePath: process.execPath,
        startedAtUtc: '1970-01-01T00:16:41.200Z',
        targetKind: 'generic-cdp' as const,
    };
    assert.doesNotThrow(() => validateProcessIdentity(evidence, target, { newlyLaunched: true }));
    assert.throws(
        () => validateProcessIdentity(evidence, { ...target, startedAtUtc: '1970-01-01T00:16:45Z' }),
        /creation time changed/,
    );
});

test('Darwin resolves absolute executable evidence from lsof text mappings, not a relative ps name', async () => {
    const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const run = async () => ({
        code: 0,
        stdout: `p42\nnthe wrong relative name\nn${executable}\nn/usr/lib/libobjc.dylib\n`,
        stderr: '',
    });
    assert.equal(await resolveUnixExecutable({ platform: 'darwin', pid: 42, comm: 'Google Chrome', run }), executable);
    await assert.rejects(
        resolveUnixExecutable({ platform: 'darwin', pid: 42, comm: 'another app', run }),
        /unverifiable/,
    );
});

test('Darwin verifies the installed executable against its mapped hard link using device and inode', async () => {
    const installed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const alias = '/private/var/folders/test/X/com.google.Chrome.code_sign_clone/clone/Contents/MacOS/Google Chrome';
    const inspected: string[] = [];
    const executable = await resolveUnixExecutable({
        platform: 'darwin',
        pid: 42,
        comm: installed,
        run: async (command, args) => {
            assert.equal(command, 'lsof');
            assert.deepEqual(args, ['-a', '-p', '42', '-d', 'txt', '-FfDin']);
            return {
                code: 0,
                stdout: `p42\nftxt\nD0x11\ni9007199254740995\nn${alias}\nftxt\nn/usr/lib/dyld\n`,
                stderr: '',
            };
        },
        fileIdentity: async (file) => {
            inspected.push(file);
            assert.equal(file, installed);
            return { dev: 17n, ino: 9007199254740995n, regularFile: true };
        },
    });
    assert.equal(executable, installed);
    assert.deepEqual(inspected, [installed]);
});

test('Darwin hard-link resolution refuses different files, incomplete evidence and ambiguous mapped aliases', async () => {
    const installed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const alias = '/private/clone/Google Chrome';
    for (const fault of [
        'device',
        'inode',
        'not-file',
        'zero-inode',
        'unreadable',
        'ambiguous',
        'missing-device',
        'bad-inode',
        'wrong-pid',
        'malformed-pid',
        'wrong-filetype',
        'duplicate-device',
        'duplicate-inode',
    ]) {
        await assert.rejects(
            resolveUnixExecutable({
                platform: 'darwin',
                pid: 42,
                comm: installed,
                run: async () => ({
                    code: 0,
                    stdout: `p${fault === 'wrong-pid' ? 43 : 42}\n${fault === 'malformed-pid' ? 'pinvalid\n' : ''}f${fault === 'wrong-filetype' ? 'cwd' : 'txt'}\n${fault === 'missing-device' ? '' : 'D0x11\n'}${fault === 'duplicate-device' ? 'D0x12\nD0x11\n' : ''}i${fault === 'bad-inode' ? 'invalid' : '42'}\n${fault === 'duplicate-inode' ? 'i43\ni42\n' : ''}n${alias}\n${fault === 'ambiguous' ? 'ftxt\nD0x11\ni42\nn/private/second/Google Chrome\n' : ''}`,
                    stderr: '',
                }),
                fileIdentity: async (file) => {
                    assert.equal(file, installed);
                    if (fault === 'unreadable') throw new Error('Cannot obtain file identity');
                    return {
                        dev: fault === 'device' ? 18n : 17n,
                        ino: fault === 'zero-inode' ? 0n : fault === 'inode' ? 43n : 42n,
                        regularFile: fault !== 'not-file',
                    };
                },
            }),
            /unverifiable or ambiguous/,
            fault,
        );
    }
});

test('Darwin unverifiable executable failures retain bounded identity evidence for diagnosis', async () => {
    const paths = Array.from({ length: 40 }, (_, index) => `/Applications/candidate-${index}/Google Chrome`);
    for (const command of ['Google Chrome', '/Applications/missing/Google Chrome']) {
        await assert.rejects(
            resolveUnixExecutable({
                platform: 'darwin',
                pid: 42,
                comm: command,
                run: async () => ({
                    code: 0,
                    stdout: `p42\n${paths.map((file) => `n${file}`).join('\n')}\nn/private/profile/History\n`,
                    stderr: '',
                }),
            }),
            (error: unknown) => {
                assert.match(error instanceof Error ? error.message : '', /unverifiable or ambiguous/);
                assert.deepEqual(errorDetails(error), {
                    phase: 'executable-identity',
                    processId: 42,
                    executableClaim: command,
                    candidateCount: 41,
                    matchCount: command === 'Google Chrome' ? 40 : 0,
                    mappedExecutablePaths: paths.slice(0, 32),
                });
                return true;
            },
        );
    }
});

test('Linux creation evidence fails closed for missing, ambiguous or malformed kernel inputs', async () => {
    for (const fault of ['pid', 'ticks', 'boot', 'duplicate-boot', 'clock', 'clock-failure', 'missing-file']) {
        await assert.rejects(
            unixSnapshot(42, 9222, {
                platform: 'linux',
                currentUser: () => 7,
                readlink: async () => process.execPath,
                readText: async (file) => {
                    if (fault === 'missing-file') throw new Error('No kernel evidence');
                    if (file === '/proc/stat')
                        return fault === 'boot'
                            ? 'btime invalid\n'
                            : fault === 'duplicate-boot'
                              ? 'btime 0\nbtime 1\n'
                              : 'btime 0\n';
                    return `${fault === 'pid' ? 43 : 42} (chrome) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 ${fault === 'ticks' ? '9007199254740993' : 100050}\n`;
                },
                run: async (executable) => {
                    if (executable === 'getconf')
                        return {
                            code: fault === 'clock-failure' ? 1 : 0,
                            stdout: fault === 'clock' ? '0\n' : '100\n',
                            stderr: '',
                        };
                    if (executable === 'ps')
                        return { code: 0, stdout: '42 1 7 Thu Jan  1 00:16:40 1970 chrome\n', stderr: '' };
                    return { code: 0, stdout: '', stderr: '' };
                },
            }),
            /kernel evidence|creation evidence/,
            fault,
        );
    }
});

test('process identity rejects executable, session, and creation-time mismatches', () => {
    const target = {
        executablePath: process.execPath,
        startedAtUtc: '2026-09-30T00:00:00Z',
        targetKind: 'generic-cdp' as const,
    };
    const evidence = {
        root: {
            exists: true as const,
            executablePath: process.execPath,
            sessionId: 1,
            startedAtUtc: target.startedAtUtc,
        },
        currentSessionId: 1,
    };
    assert.doesNotThrow(() => validateProcessIdentity(evidence, target));
    for (const changed of [
        { executablePath: '/wrong/path' },
        { sessionId: 2 },
        { startedAtUtc: '2026-09-30T00:00:05Z' },
    ]) {
        assert.throws(() => validateProcessIdentity({ ...evidence, root: { ...evidence.root, ...changed } }, target));
    }
});
