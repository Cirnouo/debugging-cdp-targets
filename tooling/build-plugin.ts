import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { readRegularFile } from '../src/adapters/file-evidence.ts';
import { isRecord } from '../src/shared/errors.ts';
import { isOfficialRelativePath } from '../src/shared/official-package.ts';
import {
    parsePluginMetadata,
    readDistributionTree,
    validateCodexSkillPresentation,
    validateHostManifest,
    validateMcpEntries,
} from './distribution-audit.ts';
import type { HostDescriptor } from './host-policy.ts';
import { CLAUDE_CODE_HOST, CODEX_HOST, PLUGIN_HOSTS, SHARED_PACKAGING_ROOT } from './host-policy.ts';
import { SHARED_ASSET_FILES, validateIconPng } from './icon-policy.ts';
import { validatePayloadFileInventory } from './payload-policy.ts';
import { validateVersionAgreement } from './version-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

async function verifyPackagingPath(packagingRoot: string, relative: string, directory: boolean) {
    const owned = path.resolve(packagingRoot);
    const input = path.resolve(owned, relative);
    const contained = path.relative(owned, input);
    if (!contained || contained.startsWith('..') || path.isAbsolute(contained))
        throw new Error('Packaging input escaped its owned directory.');
    const metadata = await lstat(input);
    if (
        metadata.isSymbolicLink() ||
        (directory ? !metadata.isDirectory() : !metadata.isFile()) ||
        path.relative(input, await realpath(input)) !== ''
    )
        throw new Error('Packaging input must be regular and must not be linked.');
    return input;
}

async function assemblePayload(host: HostDescriptor, packagingRoot: string) {
    const inputs = await readDistributionTree(await verifyPackagingPath(packagingRoot, host.inputRoot, true));
    const expectedInputs = ['README.md', ...Object.keys(host.files)];
    for (const file of inputs.keys())
        if (!expectedInputs.includes(file)) throw new Error(`Unexpected packaging input: ${file}`);
    for (const file of expectedInputs) if (!inputs.has(file)) throw new Error(`Missing packaging input: ${file}`);
    const files = new Map<string, Buffer>();
    function add(destination: string, bytes: Buffer) {
        if (files.has(destination)) throw new Error(`Duplicate packaging path: ${destination}`);
        files.set(destination, bytes);
    }
    for (const [input, destination] of Object.entries(host.files)) {
        const bytes = inputs.get(input);
        if (!bytes) throw new Error(`Missing packaging input: ${input}`);
        add(destination, bytes);
    }
    add('LICENSE', await readRegularFile(await verifyPackagingPath(packagingRoot, 'LICENSE', false)));
    const assets = await readDistributionTree(
        await verifyPackagingPath(packagingRoot, `${SHARED_PACKAGING_ROOT}/assets`, true),
    );
    for (const file of assets.keys())
        if (!SHARED_ASSET_FILES.includes(file)) throw new Error(`Unexpected shared asset: ${file}`);
    for (const file of SHARED_ASSET_FILES) {
        const bytes = assets.get(file);
        if (!bytes) throw new Error(`Missing shared asset: ${file}`);
        if (file.endsWith('.png')) {
            const errors = validateIconPng(file, bytes);
            if (errors.length) throw new Error(errors.join('\n'));
        }
    }
    for (const file of host.assets) {
        const bytes = assets.get(file);
        if (!bytes) throw new Error(`Missing shared asset: ${file}`);
        add(`assets/${file}`, bytes);
    }
    const skills = await readDistributionTree(
        await verifyPackagingPath(packagingRoot, `${SHARED_PACKAGING_ROOT}/skills`, true),
    );
    for (const [file, bytes] of skills) add(`skills/${file}`, bytes);
    const errors = [
        ...validatePayloadFileInventory([...files.keys()], host),
        ...validateHostManifest(parsePluginMetadata(files.get(host.manifest)?.toString() ?? 'null'), host),
        ...validateMcpEntries(parsePluginMetadata(files.get(host.mcp)?.toString() ?? 'null'), host),
    ];
    if (host.id === 'codex') {
        const approvedIcon = assets.get('icon.png');
        if (!approvedIcon) throw new Error('Missing approved shared Skill icon.');
        errors.push(...validateCodexSkillPresentation(files, approvedIcon));
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return files;
}

export async function assembleCodexPayload(packagingRoot = root) {
    return assemblePayload(CODEX_HOST, packagingRoot);
}

export async function assembleClaudeCodePayload(packagingRoot = root) {
    return assemblePayload(CLAUDE_CODE_HOST, packagingRoot);
}

export async function generateHostPayloads(packagingRoot = root) {
    const outputs = new Map<HostDescriptor['id'], Map<string, Buffer>>();
    const packageData = parsePluginMetadata(
        (await readRegularFile(await verifyPackagingPath(packagingRoot, 'package.json', false))).toString(),
    );
    for (const host of PLUGIN_HOSTS) {
        const files = await assemblePayload(host, packagingRoot);
        const manifest = parsePluginMetadata(files.get(host.manifest)?.toString() ?? 'null');
        const skill = files.get('skills/debugging-cdp-targets/SKILL.md')?.toString();
        const frontmatter: unknown = parseYaml(skill?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
        if (!isRecord(packageData) || !isRecord(manifest) || !isRecord(frontmatter) || !isRecord(frontmatter.metadata))
            throw new Error('Malformed Plugin version metadata.');
        const errors = validateVersionAgreement(packageData.version, manifest.version, frontmatter.metadata.version);
        if (errors.length) throw new Error(`${host.id}: ${errors.join('\n')}`);
        outputs.set(host.id, files);
    }
    return outputs;
}

export async function syncPluginFiles(
    files: ReadonlyMap<string, Buffer>,
    directory: string,
    options: { check?: boolean } = {},
) {
    for (const name of files.keys())
        if (!isOfficialRelativePath(name)) throw new Error(`Unsafe generated output path: ${name}`);
    const owned = path.resolve(directory);
    if (!(await lstat(owned)).isDirectory() || path.relative(owned, await realpath(owned)) !== '')
        throw new Error('Generated output directory must not be linked.');
    const existing = await readDistributionTree(owned);
    const obsolete = new Set(['hide-npm-console.cjs', 'control.mjs']);
    for (const name of existing.keys()) {
        if (files.has(name)) continue;
        if (options.check || !obsolete.has(name)) throw new Error(`Unexpected Plugin build output: ${name}`);
    }
    if (options.check) {
        for (const [name, bytes] of files) {
            const current = existing.get(name);
            if (!current) throw new Error(`Missing Plugin build output: ${name}`);
            if (!current.equals(bytes)) throw new Error(`Stale Plugin build: ${name}; run pnpm build:plugin.`);
        }
        return;
    }
    for (const name of existing.keys()) {
        if (files.has(name) || !obsolete.has(name)) continue;
        const destination = path.resolve(owned, name);
        const relative = path.relative(owned, destination);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
            throw new Error('Obsolete output escaped its owned directory.');
        await rm(destination);
    }
    for (const [name, bytes] of files) {
        const destination = path.join(owned, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const check = process.argv.includes('--check');
    const outputs = await generateHostPayloads();
    for (const host of PLUGIN_HOSTS) {
        const files = outputs.get(host.id);
        if (!files) throw new Error(`Missing generated host: ${host.id}`);
        const directory = path.join(root, host.payloadRoot);
        if (!check) await mkdir(directory, { recursive: true });
        await syncPluginFiles(files, directory, { check });
    }
    console.log(
        check ? 'Committed host payloads match their inputs.' : 'Complete Codex and Claude Code payloads built.',
    );
}
