import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'plugins', 'debugging-cdp-targets', 'dist');

export async function collectBundledLicenses(inputs: readonly string[], workingDirectory = root) {
    const packages = new Map<string, string>();
    for (const input of inputs) {
        if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
        let directory = path.dirname(await realpath(path.resolve(workingDirectory, input)));
        while (true) {
            try {
                const metadata: unknown = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
                if (!metadata || typeof metadata !== 'object')
                    throw new Error(`Malformed bundled package metadata: ${directory}`);
                if ('name' in metadata) {
                    if (typeof metadata.name !== 'string') throw new Error(`Malformed package name: ${directory}`);
                    packages.set(directory, metadata.name);
                    break;
                }
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            }
            const parent = path.dirname(directory);
            if (parent === directory) throw new Error(`No package root for bundled input: ${input}`);
            directory = parent;
        }
    }
    const sections = [];
    for (const [directory, name] of [...packages].sort((a, b) => a[1].localeCompare(b[1]))) {
        const licenses = (await readdir(directory))
            .filter((file) => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(file))
            .sort();
        if (!licenses.length) throw new Error(`Bundled package has no license file: ${name}`);
        for (const file of licenses)
            sections.push(`${name} — ${file}\n\n${(await readFile(path.join(directory, file), 'utf8')).trim()}\n`);
    }
    return Buffer.from(`${sections.join('\n').trimEnd()}\n`);
}

export async function generatePluginFiles() {
    const result = await build({
        absWorkingDir: root,
        entryPoints: {
            'mcp-bootstrap': path.join(root, 'src', 'interface', 'mcp-bootstrap.ts'),
            control: path.join(root, 'src', 'interface', 'control.ts'),
        },
        outdir: output,
        outExtension: { '.js': '.mjs' },
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        packages: 'bundle',
        define: { __DCT_PACKAGED_PRELOAD__: 'true' },
        legalComments: 'none',
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
        logLevel: 'warning',
        write: false,
        metafile: true,
    });
    const files = new Map(result.outputFiles.map((file) => [path.basename(file.path), Buffer.from(file.contents)]));
    for (const file of ['windows-cdp-helper.ps1']) {
        files.set(file, await readFile(path.join(root, 'src', 'adapters', file)));
    }
    const preload = await build({
        entryPoints: [path.join(root, 'src', 'adapters', 'hide-npm-console.ts')],
        outfile: path.join(output, 'hide-npm-console.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24',
        legalComments: 'none',
        write: false,
    });
    for (const file of preload.outputFiles) files.set(path.basename(file.path), Buffer.from(file.contents));
    const notice = await collectBundledLicenses(Object.keys(result.metafile.inputs));
    files.set('THIRD-PARTY-NOTICES.txt', notice);
    return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const check = process.argv.includes('--check');
    for (const [name, contents] of await generatePluginFiles()) {
        const destination = path.join(output, name);
        if (check) {
            if (!contents.equals(await readFile(destination)))
                throw new Error(`Stale Plugin build: ${name}; run pnpm build:plugin.`);
        } else await writeFile(destination, contents);
    }
    console.log(check ? 'Committed Plugin runtime matches its source.' : 'Plugin runtime built.');
}
