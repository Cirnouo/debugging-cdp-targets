import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { readRegularFile } from '../../src/adapters/file-evidence.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import { validateIconPng } from './artwork-policy.ts';
import { PLUGIN_HOSTS, SHARED_PACKAGING_ROOT } from './host-descriptors.ts';
import {
    parsePluginMetadata,
    validateCodexSkillPresentation,
    validateHostManifest,
    validateMarketplace,
    validateMcpEntries,
} from './host-metadata.ts';
import { requiredPayloadFiles, validatePayloadFileInventory } from './payload-inventory.ts';
import { compareDistributionTrees, readDistributionTree } from './regular-file-tree.ts';
import { validateVersionAgreement } from './version-agreement.ts';

async function readMetadataFile(file: string) {
    if (path.relative(path.resolve(file), await realpath(file)) !== '')
        throw new Error('Plugin metadata must not contain linked paths.');
    return readRegularFile(file);
}

export async function auditDistribution(root: string) {
    const errors: string[] = [];
    const payloads = new Map<string, Map<string, Buffer>>();
    const packageData = parsePluginMetadata((await readMetadataFile(path.join(root, 'package.json'))).toString());
    const license = await readMetadataFile(path.join(root, 'LICENSE'));
    const sharedSkills = await readDistributionTree(path.join(root, SHARED_PACKAGING_ROOT, 'skills'));
    const skill = sharedSkills.get('debugging-cdp-targets/SKILL.md')?.toString();
    const frontmatter: unknown = parseYaml(skill?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    const skillVersion =
        isRecord(frontmatter) && isRecord(frontmatter.metadata) ? frontmatter.metadata.version : undefined;
    const approvedIcon = await readMetadataFile(path.join(root, SHARED_PACKAGING_ROOT, 'assets/icon.png'));
    for (const host of PLUGIN_HOSTS) {
        try {
            const source = await readDistributionTree(path.join(root, host.payloadRoot));
            payloads.set(host.id, source);
            for (const [file, bytes] of sharedSkills) {
                const delivered = source.get(`skills/${file}`);
                if (!delivered) errors.push(`${host.id}: Missing shared Skill file: ${file}`);
                else if (!delivered.equals(bytes)) errors.push(`${host.id}: Changed shared Skill file: ${file}`);
            }
            const hostOnlySkills = new Set(Object.values(host.files).filter((file) => file.startsWith('skills/')));
            for (const file of source.keys()) {
                if (
                    file.startsWith('skills/') &&
                    !hostOnlySkills.has(file) &&
                    !sharedSkills.has(file.slice('skills/'.length))
                )
                    errors.push(`${host.id}: Unexpected shared Skill file: ${file.slice('skills/'.length)}`);
            }
            errors.push(
                ...validatePayloadFileInventory([...source.keys()], host).map((error) => `${host.id}: ${error}`),
            );
            for (const asset of host.assets) {
                const file = `assets/${asset}`;
                const bytes = source.get(file);
                if (bytes) errors.push(...validateIconPng(file, bytes));
            }
            if (host.id === 'codex') errors.push(...validateCodexSkillPresentation(source, approvedIcon));
            const manifest = parsePluginMetadata(source.get(host.manifest)?.toString() ?? 'null');
            errors.push(...validateHostManifest(manifest, host));
            errors.push(...validateMcpEntries(parsePluginMetadata(source.get(host.mcp)?.toString() ?? 'null'), host));
            errors.push(
                ...validateMarketplace(
                    parsePluginMetadata((await readMetadataFile(path.join(root, host.marketplace))).toString()),
                    host,
                ),
            );
            errors.push(
                ...validateVersionAgreement(
                    isRecord(packageData) ? packageData.version : undefined,
                    isRecord(manifest) ? manifest.version : undefined,
                    skillVersion,
                ).map((error) => `${host.id}: ${error}`),
            );
            if (!source.get('LICENSE')?.equals(license))
                errors.push(`${host.id}: Root and Plugin licenses must match.`);
            const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-distribution-')));
            try {
                for (const file of requiredPayloadFiles(host)) {
                    const contents = source.get(file);
                    if (!contents) continue;
                    const destination = path.join(temporary, file);
                    await mkdir(path.dirname(destination), { recursive: true });
                    await writeFile(destination, contents);
                }
                errors.push(...compareDistributionTrees(source, await readDistributionTree(temporary)));
            } finally {
                await rm(temporary, { recursive: true });
            }
        } catch (error) {
            errors.push(`${host.id}: ${errorMessage(error)}`);
        }
    }
    const codex = payloads.get('codex');
    const claude = payloads.get('claude-code');
    if (codex && claude) {
        for (const [file, bytes] of codex)
            if ((file === 'LICENSE' || file.startsWith('dist/')) && !claude.get(file)?.equals(bytes))
                errors.push(`Shared payload bytes differ: ${file}`);
    }
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const errors = await auditDistribution(process.cwd());
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Plugin inventory, manifests, and byte-identical packaging passed.');
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
