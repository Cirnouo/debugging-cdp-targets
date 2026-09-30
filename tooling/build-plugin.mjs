import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'plugins', 'debugging-cdp-targets', 'dist');

export async function generatePluginFiles() {
    const result = await build({
        absWorkingDir: root,
        entryPoints: {
            'mcp-bootstrap': path.join(root, 'src', 'interface', 'mcp-bootstrap.mjs'),
            control: path.join(root, 'src', 'interface', 'control.mjs'),
        },
        outdir: output,
        outExtension: { '.js': '.mjs' },
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
    const files = new Map(result.outputFiles.map((file) => [path.basename(file.path), Buffer.from(file.contents)]));
    for (const file of ['windows-cdp-helper.ps1', 'hide-npm-console.cjs']) {
        files.set(file, await readFile(path.join(root, 'src', 'adapters', file)));
    }
    const notice = await readFile(path.join(root, 'node_modules', 'ws', 'LICENSE'));
    if (!notice.toString().includes('MIT')) throw new Error('The bundled WebSocket dependency license changed.');
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
