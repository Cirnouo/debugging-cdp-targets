import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isRecord } from '../src/shared/errors.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'plugins', 'debugging-cdp-targets', 'dist');

type ReviewedBundle = {
    name: string;
    version: string;
    file: string;
    sha256: string;
    mapSha256?: string;
};
type ReviewedLicense = {
    name: string;
    version: string;
    licenseFile: string;
    licenseText: string;
    licenseSha256: string;
};
type VendorReview = { bundles: Map<string, ReviewedBundle>; licenses: Map<string, ReviewedLicense> };

function sha256(contents: string | Buffer) {
    return createHash('sha256').update(contents).digest('hex');
}

async function readVendorReview(file: string): Promise<VendorReview> {
    const input: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (
        !isRecord(input) ||
        input.schemaVersion !== 1 ||
        !Array.isArray(input.bundles) ||
        !Array.isArray(input.packages)
    )
        throw new Error('Malformed vendored license evidence.');
    const bundles = new Map<string, ReviewedBundle>();
    const licenses = new Map<string, ReviewedLicense>();
    for (const entries of [input.bundles, input.packages]) {
        for (const entry of entries) {
            if (
                !isRecord(entry) ||
                typeof entry.name !== 'string' ||
                typeof entry.version !== 'string' ||
                typeof entry.tarball !== 'string' ||
                !entry.tarball.startsWith('https://registry.npmjs.org/') ||
                typeof entry.integrity !== 'string' ||
                !entry.integrity.startsWith('sha512-')
            )
                throw new Error('Malformed vendored package provenance.');
        }
    }
    for (const entry of input.bundles) {
        if (
            !isRecord(entry) ||
            typeof entry.name !== 'string' ||
            typeof entry.version !== 'string' ||
            typeof entry.file !== 'string' ||
            typeof entry.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(entry.sha256) ||
            (entry.mapSha256 !== undefined &&
                (typeof entry.mapSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.mapSha256)))
        )
            throw new Error('Malformed vendored bundle evidence.');
        const key = `${entry.name}@${entry.version}/${entry.file}`;
        if (bundles.has(key)) throw new Error(`Duplicate vendored bundle evidence: ${key}`);
        bundles.set(key, {
            name: entry.name,
            version: entry.version,
            file: entry.file,
            sha256: entry.sha256,
            ...(typeof entry.mapSha256 === 'string' ? { mapSha256: entry.mapSha256 } : {}),
        });
    }
    for (const entry of input.packages) {
        if (
            !isRecord(entry) ||
            typeof entry.name !== 'string' ||
            typeof entry.version !== 'string' ||
            typeof entry.license !== 'string' ||
            typeof entry.licenseFile !== 'string' ||
            typeof entry.licenseText !== 'string' ||
            !entry.licenseText.trim() ||
            typeof entry.licenseSha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(entry.licenseSha256)
        )
            throw new Error('Malformed vendored license evidence.');
        if (sha256(entry.licenseText) !== entry.licenseSha256)
            throw new Error(`Changed vendored license fingerprint: ${entry.name}@${entry.version}`);
        const key = `${entry.name}@${entry.version}`;
        if (licenses.has(key)) throw new Error(`Duplicate vendored license evidence: ${key}`);
        licenses.set(key, {
            name: entry.name,
            version: entry.version,
            licenseFile: entry.licenseFile,
            licenseText: entry.licenseText,
            licenseSha256: entry.licenseSha256,
        });
    }
    return { bundles, licenses };
}

async function collectVendorSections(
    input: string,
    directory: string,
    name: string,
    version: unknown,
    review: VendorReview,
) {
    const file = path.relative(directory, input).replaceAll('\\', '/');
    const key = `${name}@${String(version)}/${file}`;
    const bundle = review.bundles.get(key);
    if (!bundle) throw new Error(`Unreviewed SDK bundle: ${key}`);
    if (sha256(await readFile(input)) !== bundle.sha256) throw new Error(`Changed bundled source fingerprint: ${key}`);
    const sections = new Map<string, string>();
    if (bundle.mapSha256 === undefined) return sections;
    const map = await readFile(`${input}.map`);
    if (sha256(map) !== bundle.mapSha256) throw new Error(`Changed source map fingerprint: ${key}`);
    const sourceMap: unknown = JSON.parse(map.toString('utf8'));
    if (
        !isRecord(sourceMap) ||
        sourceMap.version !== 3 ||
        !Array.isArray(sourceMap.sources) ||
        !sourceMap.sources.every((source) => typeof source === 'string')
    )
        throw new Error(`Malformed vendored source map: ${key}`);
    for (const source of sourceMap.sources) {
        const parts = source.split('/');
        const index = parts.indexOf('.pnpm');
        if (index === -1) {
            if (source.includes('/node_modules/')) throw new Error(`Unsupported vendored source identity: ${source}`);
            continue;
        }
        const storeIdentity = parts[index + 1];
        const packagePart = parts[index + 3];
        const packageName = packagePart?.startsWith('@') ? `${packagePart}/${parts[index + 4]}` : packagePart;
        const prefix = `${packageName?.replace('/', '+')}@`;
        if (!packageName || !storeIdentity?.startsWith(prefix) || parts[index + 2] !== 'node_modules')
            throw new Error(`Malformed vendored source identity: ${source}`);
        const packageVersion = storeIdentity.slice(prefix.length).split('_')[0];
        const identity = `${packageName}@${packageVersion}`;
        const license = review.licenses.get(identity);
        if (!license) throw new Error(`Unreviewed vendored package: ${identity}`);
        sections.set(identity, `${identity} — ${license.licenseFile} (vendored)\n\n${license.licenseText.trim()}\n`);
    }
    return sections;
}

export async function collectBundledLicenses(
    inputs: readonly string[],
    workingDirectory = root,
    evidenceFile = path.join(root, 'tooling', 'vendored-licenses.json'),
) {
    const packages = new Map<string, string>();
    const vendors = new Map<string, string>();
    let review: VendorReview | undefined;
    for (const input of inputs) {
        if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
        const resolved = await realpath(path.resolve(workingDirectory, input));
        let directory = path.dirname(resolved);
        while (true) {
            let metadata: unknown;
            try {
                metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            }
            if (metadata !== undefined) {
                if (!metadata || typeof metadata !== 'object')
                    throw new Error(`Malformed bundled package metadata: ${directory}`);
                if ('name' in metadata) {
                    if (typeof metadata.name !== 'string') throw new Error(`Malformed package name: ${directory}`);
                    packages.set(directory, metadata.name);
                    if (metadata.name.startsWith('@modelcontextprotocol/')) {
                        review ??= await readVendorReview(evidenceFile);
                        const sections = await collectVendorSections(
                            resolved,
                            directory,
                            metadata.name,
                            'version' in metadata ? metadata.version : undefined,
                            review,
                        );
                        for (const [identity, section] of sections) vendors.set(identity, section);
                    }
                    break;
                }
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
    for (const [, section] of [...vendors].sort((a, b) => a[0].localeCompare(b[0]))) sections.push(section);
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
