import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { NPM_REGISTRY } from '../../src/shared/constants.mjs';
import { readLockInventory, validateConfigurationDependencies } from './audit-policy.mjs';

export const INSTALL_POLICY = Object.freeze({
    minimumReleaseAge: 1440,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
    trustLockfile: false,
    trustPolicy: 'no-downgrade',
    blockExoticSubdeps: true,
    strictDepBuilds: true,
});

export function validateInstallPolicy(config, isolated = false) {
    validateConfigurationDependencies(config.configDependencies);
    for (const [key, value] of Object.entries(INSTALL_POLICY)) {
        if (config[key] !== value) throw new Error(`Unsafe installation policy: ${key}`);
    }
    const expected = isolated ? {} : { 'esbuild@0.28.2': true };
    if (JSON.stringify(config.allowBuilds) !== JSON.stringify(expected))
        throw new Error('Unreviewed dependency build scripts.');
    for (const key of [
        'minimumReleaseAgeExclude',
        'trustPolicyExclude',
        'onlyBuiltDependencies',
        'ignoredBuiltDependencies',
        'dangerouslyAllowAllBuilds',
        'ignoredOptionalDependencies',
    ]) {
        if (Object.hasOwn(config, key)) throw new Error(`Installation bypass is prohibited: ${key}`);
    }
    for (const [key, value] of Object.entries(config.auditConfig ?? {})) {
        if (
            !['ignoreCves', 'ignoreGhsas', 'ignoreUnfixable'].includes(key) ||
            (Array.isArray(value) ? value.length > 0 : value !== false)
        )
            throw new Error('Audit exclusions are prohibited.');
    }
    for (const [key, value] of Object.entries(config.audit ?? {})) {
        if (
            !(
                (key === 'level' && value === 'info') ||
                (key === 'ignore' && Array.isArray(value) && value.length === 0) ||
                (key === 'ignorePrune' && value === false)
            )
        )
            throw new Error('Filtered audit configuration is prohibited.');
    }
    for (const key of ['production', 'prod', 'dev', 'ignoreRegistryErrors', 'noOptional', 'ignoreUnfixable']) {
        if (config[key] === true) throw new Error(`Filtered or permissive audit configuration: ${key}`);
    }
    if (config.optional === false) throw new Error('Optional dependencies must be included.');
    if (config.registry && config.registry.replace(/\/$/, '') !== NPM_REGISTRY)
        throw new Error('Unexpected audit registry.');
}

export function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
        );
    return value;
}
function graph(doc) {
    return canonical({ importers: doc.importers, packages: doc.packages, snapshots: doc.snapshots });
}
export async function verifyLockManifest(root, inventory) {
    const runtime = inventory.documents.filter((doc) => !doc.importers['.'].packageManagerDependencies);
    if (runtime.length !== 1) throw new Error('Lockfile must have exactly one runtime dependency graph.');
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const expected = manifest[group] ?? {};
        const actual = runtime[0].importers['.'][group] ?? {};
        if (
            Object.keys(expected).length !== Object.keys(actual).length ||
            Object.entries(expected).some(([name, version]) => actual[name]?.specifier !== version)
        )
            throw new Error(`Lockfile importer differs from manifest ${group}.`);
    }
    return runtime[0];
}
export async function verifyInstalledTree(root, inventory) {
    const runtime = await verifyLockManifest(root, inventory);
    const modules = parse(await readFile(path.join(root, 'node_modules/.modules.yaml'), 'utf8'));
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        if (modules.included?.[group] !== true) throw new Error(`Installed tree excluded ${group}.`);
    }
    const installed = readLockInventory(await readFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), 'utf8'));
    if (
        installed.documents.length !== 1 ||
        JSON.stringify(graph(runtime)) !== JSON.stringify(graph(installed.documents[0]))
    )
        throw new Error('Installed dependency graph differs from lockfile.');
}

async function hashFiles(root, files) {
    if (!files.length) throw new Error('Empty evidence file set.');
    const hash = createHash('sha256');
    for (const file of [...files].sort()) {
        const absolute = path.resolve(root, file);
        if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !(await lstat(absolute)).isFile())
            throw new Error(`Unsafe evidence path: ${file}`);
        const bytes = await readFile(absolute);
        hash.update(`${file}\0${bytes.length}\0`).update(bytes);
    }
    return hash.digest('hex');
}
export async function fingerprintInputs(root, codeFiles, configurationFiles, inventory) {
    return {
        code: await hashFiles(root, codeFiles),
        configuration: await hashFiles(root, configurationFiles),
        dependencies: createHash('sha256')
            .update(JSON.stringify(canonical(inventory.documents)))
            .digest('hex'),
    };
}
