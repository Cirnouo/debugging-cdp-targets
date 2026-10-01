import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isRecord } from '../src/shared/errors.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'tooling/security/dist');

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
    const license = await readFile(path.join(root, 'node_modules/yaml/LICENSE'));
    const metadata: unknown = JSON.parse(await readFile(path.join(root, 'node_modules/yaml/package.json'), 'utf8'));
    if (!isRecord(metadata) || metadata.license !== 'ISC' || !license.toString().includes('Copyright Eemeli Aro'))
        throw new Error('The bundled YAML dependency license changed.');
    files.set('THIRD-PARTY-NOTICES.txt', license);
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
