import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readRegularFile } from '../../src/adapters/file-evidence.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { verifyNativeFixtureSeal } from '../../tooling/native-fixture-verification.ts';
import { guiAuthorization } from '../gui-authorization.ts';

type StudyKind = 'layers' | 'timeout';
export interface SealedStudyIo {
    environment: NodeJS.ProcessEnv;
    listFiles(root: string): Promise<string[]>;
    readFile(file: string): Promise<Uint8Array>;
    run(
        executable: string,
        args: string[],
        env: NodeJS.ProcessEnv,
    ): Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
    }>;
}

function nativeIo(): SealedStudyIo {
    return {
        environment: process.env,
        async listFiles(root) {
            const canonical = await realpath(root);
            assert.equal(path.relative(canonical, path.resolve(root)), '', 'Sealed stage cannot use a linked root.');
            const files: string[] = [];
            async function visit(directory: string) {
                for (const entry of await readdir(directory, { withFileTypes: true })) {
                    const file = path.join(directory, entry.name);
                    assert.ok(!entry.isSymbolicLink(), 'Sealed closure cannot contain linked assets.');
                    if (entry.isDirectory()) await visit(file);
                    else {
                        assert.ok(entry.isFile(), 'Sealed closure requires ordinary files.');
                        files.push(path.relative(root, file).replaceAll('\\', '/'));
                    }
                }
            }
            await visit(root);
            return files;
        },
        readFile: readRegularFile,
        run: (executable, args, env) =>
            new Promise((resolve, reject) => {
                const child = spawn(executable, args, {
                    shell: false,
                    windowsHide: true,
                    stdio: 'inherit',
                    env,
                });
                child.once('error', reject);
                child.once('close', (code, signal) => resolve({ code, signal }));
            }),
    };
}

export function sealedStudyEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(environment).filter(([key]) => !['node_options', 'node_path'].includes(key.toLowerCase())),
    );
}

/** This private launcher performs only authorization, seal reads and an explicit verified child launch. */
export async function verifySealedStudy(
    kind: StudyKind,
    rawArgs: readonly string[],
    io: SealedStudyIo = nativeIo(),
    identity?: { entry: string; nodeExecutable: string },
) {
    const authorization = guiAuthorization(rawArgs);
    assert.ok(authorization.allowed, 'Native study requires explicit --allow-gui authorization.');
    const args = [...authorization.args];
    const index = args.indexOf('--stage');
    assert.ok(index >= 0 && args.lastIndexOf('--stage') === index, 'Supply one explicit --stage.');
    const stage = args[index + 1];
    assert.ok(stage && path.isAbsolute(stage), 'Study stage must be an absolute path.');
    args.splice(index, 2);
    assert.ok(
        args.length === 2 && args.every((argument) => path.isAbsolute(argument)),
        'Supply absolute fixture JSON and evidence parent paths plus --stage.',
    );
    const receipt: unknown = JSON.parse(Buffer.from(await io.readFile(`${stage}.receipt.json`)).toString('utf8'));
    const verified = await verifyNativeFixtureSeal(stage, receipt, io);
    assert.ok(isRecord(receipt) && isRecord(receipt.source));
    assert.equal(receipt.source.dirty, false, 'Measured study requires a clean-source seal.');
    const source = {
        revision: String(receipt.source.revision),
        digest: String(receipt.source.digest),
        inventoryDigest: verified.inventoryDigest,
    };
    if (identity) {
        assert.equal(path.resolve(identity.entry), path.resolve(verified.studyEntries[kind]), 'Study entry mismatch.');
        assert.equal(
            path.resolve(identity.nodeExecutable),
            path.resolve(verified.nodeExecutable),
            'Study requires the sealed original ordinary Node.',
        );
    }
    return { ...verified, args, source };
}

export type VerifiedSealedStudy = Awaited<ReturnType<typeof verifySealedStudy>>;

export async function launchSealedStudy(kind: StudyKind, rawArgs: readonly string[], io: SealedStudyIo = nativeIo()) {
    if (!guiAuthorization(rawArgs).allowed) return { skipped: true } as const;
    const verified = await verifySealedStudy(kind, rawArgs, io);
    const result = await io.run(
        verified.nodeExecutable,
        [verified.studyEntries[kind], ...rawArgs],
        sealedStudyEnvironment(io.environment),
    );
    assert.ok(result.code === 0 && result.signal === null, 'Sealed study child did not exit normally with code zero.');
    return { skipped: false, source: verified.source, exit: result } as const;
}
