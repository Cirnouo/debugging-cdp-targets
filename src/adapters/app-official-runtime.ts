import path from 'node:path';
import { parseAppReleaseInputs } from '../domains/app-release.ts';
import { parseOfficialReleaseEvidence } from '../gateway/official/release-evidence.ts';
import { verifyAppReleaseTree } from './app-delivery.ts';
import { readRegularFile } from './file-evidence.ts';
import { verifyOfficialPackage } from './official-package.ts';

/** Verify original delivered inputs before either catalog discovery or a connection can spawn. */
export async function verifyAppOfficialRuntime(options: {
    directory: string;
    resources: string;
    platform: string;
    architecture: string;
}) {
    const inputs = parseAppReleaseInputs(
        JSON.parse(
            (await readRegularFile(path.join(options.directory, 'delivery/app-release-inputs.json'))).toString('utf8'),
        ),
    );
    const node = inputs.archives.find(
        (item) =>
            item.kind === 'node' && item.platform === options.platform && item.architecture === options.architecture,
    );
    if (!node?.runtimeFiles) throw new Error('Ordinary Node extraction evidence is unavailable for this distribution.');
    const nodeDirectory = path.join(options.resources, 'node');
    await verifyAppReleaseTree(
        nodeDirectory,
        node.runtimeFiles.map((file) => ({ path: file.destination, bytes: file.bytes, sha256: file.sha256 })),
    );
    const release = parseOfficialReleaseEvidence(
        JSON.parse(
            (await readRegularFile(path.join(options.directory, 'delivery/official-server-release.json'))).toString(
                'utf8',
            ),
        ),
    );
    const officialDirectory = path.join(options.resources, 'official-server');
    await verifyOfficialPackage(officialDirectory, release);
    return Object.freeze({
        nodeExecutable: path.join(nodeDirectory, options.platform === 'win32' ? 'node.exe' : 'bin/node'),
        bin: path.join(officialDirectory, release.bin),
    });
}
