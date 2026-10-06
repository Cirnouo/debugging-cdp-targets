import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isRecord } from '../src/shared/errors.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'tooling/security/dist');

export async function readSecurityNotices(dependencies: string) {
    const notices: Buffer[] = [];
    for (const dependency of [
        {
            name: 'yaml',
            version: '2.9.1',
            licenseSha256: '5bba27375d93e9119f76c1015f7672cf9ad5f70952296e0842fb2243d6376869',
        },
        {
            name: 'semver',
            version: '7.8.5',
            licenseSha256: '4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b',
        },
    ]) {
        const license = await readFile(path.join(dependencies, dependency.name, 'LICENSE'));
        const metadata: unknown = JSON.parse(
            await readFile(path.join(dependencies, dependency.name, 'package.json'), 'utf8'),
        );
        if (
            !isRecord(metadata) ||
            metadata.name !== dependency.name ||
            metadata.version !== dependency.version ||
            metadata.license !== 'ISC' ||
            createHash('sha256').update(license).digest('hex') !== dependency.licenseSha256
        )
            throw new Error(`The bundled ${dependency.name} dependency license changed.`);
        if (dependency.name !== 'yaml')
            notices.push(Buffer.from(`\n--- ${dependency.name}@${dependency.version} (ISC) ---\n\n`));
        notices.push(license);
    }
    return Buffer.concat(notices);
}

export async function generateSecurityFiles() {
    const result = await build({
        absWorkingDir: root,
        entryPoints: [path.join(root, 'tooling/check-security.ts')],
        outfile: path.join(output, 'check-security.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        packages: 'bundle',
        legalComments: 'none',
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
        logLevel: 'warning',
        write: false,
    });
    const bundledFile = result.outputFiles[0];
    if (!bundledFile) throw new Error('The security build produced no output.');
    const files = new Map([['check-security.mjs', Buffer.from(bundledFile.contents)]]);
    files.set('THIRD-PARTY-NOTICES.txt', await readSecurityNotices(path.join(root, 'node_modules')));
    return files;
}

export async function verifySecurityFiles(directory: string, files: Map<string, Buffer>) {
    for (const [name, contents] of files) {
        if (!contents.equals(await readFile(path.join(directory, name))))
            throw new Error(`Stale security build: ${name}; run pnpm build:security.`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = await generateSecurityFiles();
    if (process.argv.includes('--check')) {
        await verifySecurityFiles(output, files);
        console.log('Committed security checker matches its source.');
    } else {
        await mkdir(output, { recursive: true });
        for (const [name, contents] of files) await writeFile(path.join(output, name), contents);
        console.log('Standalone security checker built.');
    }
}
