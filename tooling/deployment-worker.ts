import type { BigIntStats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAppReleaseTree, verifyDeploymentPayload } from '../src/adapters/app-delivery.ts';
import { type DeploymentLease, openDeploymentInstallation } from '../src/adapters/app-deployment.ts';
import { openDeploymentNativeAuthority } from '../src/adapters/app-deployment-native.ts';
import { loadAppAdvisoryLock } from '../src/adapters/app-native.ts';
import { readRegularFile } from '../src/adapters/file-evidence.ts';
import { requireWindowsDeploymentQueryBinding } from '../src/adapters/windows-deployment-query.ts';
import { parseAppNativeEvidence, parseAppReleaseInputs } from '../src/domains/app-release.ts';

// Executing-code/native-loading trust is intrinsic; capture every fixed locator before awaits.
const moduleFile = fileURLToPath(import.meta.url);
const executable = process.execPath;
const appDirectory = path.dirname(moduleFile);
const resources = path.dirname(appDirectory);
const buildRoot = path.dirname(resources);
const buildId = path.basename(buildRoot);
const builds = path.dirname(buildRoot);
const installationRoot = path.dirname(builds);
const nodeDirectory = path.join(resources, 'node');
const nodeExecutable = path.join(nodeDirectory, 'node.exe');
const suppliedArguments = Object.freeze(process.argv.slice(2));

/** One private action: ordinary read/use, complete own-build verification and terminal release. */
export async function verifyFreshDeployment() {
    requireWindowsDeploymentQueryBinding(); // Unbound source composition rejects before all file/native/process I/O.
    if (
        process.platform !== 'win32' ||
        process.arch !== 'x64' ||
        suppliedArguments.length ||
        path.basename(moduleFile) !== 'deployment-worker.mjs' ||
        path.basename(appDirectory) !== 'app' ||
        path.basename(resources) !== 'resources' ||
        path.basename(builds) !== 'builds' ||
        !/^[0-9a-f]{64}$/.test(buildId) ||
        executable !== nodeExecutable
    )
        throw new Error('Invalid intrinsic deployment worker placement or Node.');
    const directories = [installationRoot, builds, buildRoot, resources, appDirectory, nodeDirectory];
    const identities = new Map<string, BigIntStats>();
    async function current() {
        for (const name of [...directories, moduleFile, nodeExecutable]) {
            const entry = await lstat(name, { bigint: true });
            if (
                entry.isSymbolicLink() ||
                (directories.includes(name) ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1n) ||
                (await realpath(name)) !== name
            )
                throw new Error('Deployment worker intrinsic path is linked or unsafe.');
            const old = identities.get(name);
            if (
                old &&
                (old.dev !== entry.dev ||
                    old.ino !== entry.ino ||
                    old.mode !== entry.mode ||
                    (!entry.isDirectory() &&
                        (old.size !== entry.size ||
                            old.nlink !== entry.nlink ||
                            old.mtimeNs !== entry.mtimeNs ||
                            old.ctimeNs !== entry.ctimeNs)))
            )
                throw new Error('Deployment worker intrinsic identity changed.');
            identities.set(name, entry);
        }
    }
    await current();
    const release = parseAppReleaseInputs(
        JSON.parse(
            (await readRegularFile(path.join(appDirectory, 'delivery/app-release-inputs.json'))).toString('utf8'),
        ),
    );
    const node = release.archives.find(
        (entry) => entry.kind === 'node' && entry.platform === 'win32' && entry.architecture === 'x64',
    );
    if (!node?.runtimeFiles) throw new Error('Worker original Node evidence unavailable.');
    await verifyAppReleaseTree(
        nodeDirectory,
        node.runtimeFiles.map((file) => ({ ...file, path: file.destination })),
    );
    const native = parseAppNativeEvidence(
        JSON.parse(
            (await readRegularFile(path.join(appDirectory, 'delivery/app-native-release.json'))).toString('utf8'),
        ),
    );
    const tryLock = await loadAppAdvisoryLock(native);
    const reader = await openDeploymentInstallation(installationRoot, { tryLock });
    let use: DeploymentLease | undefined,
        primary: unknown,
        failed = false;
    let result: Awaited<ReturnType<typeof reader.read>> | undefined;
    try {
        use = await reader.tryAcquire('use');
        if (!use) throw new Error('Deployment worker shared use is unavailable.');
        const state = await reader.read(use);
        if (state.phase !== 'active' || state.selectedBuildId !== buildId)
            throw new Error('Deployment worker selection is not its own build.');
        const selection = {
            selectedBuildId: state.selectedBuildId,
            selectedManifestSha256: state.selectedManifestSha256,
            platform: 'win32' as const,
            architecture: 'x64' as const,
        };
        const authority = await openDeploymentNativeAuthority(installationRoot, false);
        const payload = await verifyDeploymentPayload(buildRoot, selection);
        const checks = [];
        for (const entry of [...payload.manifest.entries, { path: 'payload-manifest.json', type: 'file' }]) {
            const file = path.join(buildRoot, ...entry.path.split('/'));
            checks.push({
                file,
                stats: await lstat(file, { bigint: true }),
                purpose: entry.type === 'directory' ? ('directory' as const) : ('document' as const),
            });
        }
        await authority.ancestors();
        await authority.entries(checks);
        await verifyDeploymentPayload(buildRoot, selection);
        await authority.entries(checks);
        if (JSON.stringify(await reader.read(use)) !== JSON.stringify(state))
            throw new Error('Deployment worker selection changed.');
        await current();
        await verifyAppReleaseTree(
            nodeDirectory,
            node.runtimeFiles.map((file) => ({ ...file, path: file.destination })),
        );
        result = state;
    } catch (error) {
        primary = error;
        failed = true;
    }
    if (use) {
        try {
            await use.release();
        } catch (close) {
            throw failed
                ? new AggregateError([primary, close], 'Worker verification and shared-use release failed.')
                : close;
        }
    }
    if (failed) throw primary;
    if (!result) throw new Error('Missing deployment worker verified state.');
    return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
    const state = await verifyFreshDeployment();
    const bytes = Buffer.from(JSON.stringify(state) + '\n');
    if (bytes.length > 1024) throw new Error('Deployment worker state exceeds bound.');
    await new Promise<void>((resolve, reject) =>
        process.stdout.write(bytes, (error) => (error ? reject(error) : resolve())),
    );
}
