import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegularFile } from '../../src/adapters/file-evidence.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { RUNTIME_LICENSE_INPUTS } from './canonical-inputs.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

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
    evidenceFile = path.join(root, 'tooling', 'licenses', 'reviewed-vendors.json'),
) {
    const packages = new Map<string, string>();
    const vendors = new Map<string, string>();
    let review: VendorReview | undefined;
    for (const input of inputs) {
        if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
        const inputPath = path.resolve(workingDirectory, input);
        const resolved = await realpath(inputPath);
        const canonicalBoundary = (file: string) => {
            const parts = file.split(path.sep);
            const index = parts.lastIndexOf('node_modules');
            const identity =
                index < 0 ? undefined : RUNTIME_LICENSE_INPUTS.find((item) => item.name === parts[index + 1]);
            return identity ? { identity, root: parts.slice(0, index + 2).join(path.sep) } : undefined;
        };
        const canonicalPackage = canonicalBoundary(resolved) ?? canonicalBoundary(inputPath);
        if (canonicalPackage) {
            try {
                const directory = await realpath(canonicalPackage.root);
                const relative = path.relative(directory, resolved);
                const metadata: unknown = JSON.parse(
                    (await readRegularFile(path.join(directory, 'package.json'))).toString('utf8'),
                );
                const expected = canonicalPackage.identity;
                if (
                    !relative ||
                    relative.startsWith('..') ||
                    path.isAbsolute(relative) ||
                    !isRecord(metadata) ||
                    metadata.name !== expected.name ||
                    metadata.version !== expected.version ||
                    metadata.license !== expected.license ||
                    sha256(await readRegularFile(path.join(directory, 'LICENSE'))) !== expected.licenseSha256
                )
                    throw new Error('Invalid canonical package.');
                packages.set(directory, expected.name);
                continue;
            } catch {
                throw new Error('Canonical bundled package license or metadata changed.');
            }
        }
        let directory = path.dirname(resolved);
        while (true) {
            let metadata: unknown;
            try {
                metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            }
            if (metadata !== undefined) {
                if (!isRecord(metadata)) throw new Error(`Malformed bundled package metadata: ${directory}`);
                if ('name' in metadata) {
                    if (typeof metadata.name !== 'string') throw new Error(`Malformed package name: ${directory}`);
                    const canonical = RUNTIME_LICENSE_INPUTS.find(
                        (item) => item.name === metadata.name || item.name === path.basename(directory),
                    );
                    if (
                        canonical &&
                        (metadata.name !== canonical.name ||
                            Reflect.get(metadata, 'version') !== canonical.version ||
                            Reflect.get(metadata, 'license') !== canonical.license ||
                            sha256(await readRegularFile(path.join(directory, 'LICENSE'))) !== canonical.licenseSha256)
                    )
                        throw new Error('Canonical bundled package license or identity changed.');
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
