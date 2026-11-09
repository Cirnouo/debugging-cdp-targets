import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import { isApprovedIconPath, validateIconPng } from '../distribution/artwork-policy.ts';
import { PLUGIN_HOSTS, SHARED_PACKAGING_ROOT } from '../distribution/host-descriptors.ts';
import { validateVersionAgreement } from '../distribution/version-agreement.ts';
import { validateRuntimeSource } from './runtime-boundaries.ts';
import { validateTextStyle, validateYamlFilename } from './text-policy.ts';

export async function auditRepository(root: string) {
    const errors = [];
    const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((file) => file && existsSync(path.join(root, file)));
    const files = new Map(
        paths.map((file) => {
            const bytes = readFileSync(path.join(root, file));
            if (isApprovedIconPath(file)) {
                const absolute = path.resolve(root, file);
                if (!lstatSync(absolute).isFile() || path.relative(absolute, realpathSync(absolute)) !== '')
                    errors.push(`${file}: icon PNG must be regular and must not contain linked paths.`);
                const iconErrors = validateIconPng(file, bytes);
                errors.push(...iconErrors);
                return [file, ''] as const;
            }
            if (/\.png$/i.test(file)) errors.push(`${file}: unexpected PNG outside approved icon paths.`);
            return [file, bytes.toString('utf8')] as const;
        }),
    );
    const directories = new Set(
        paths.flatMap((file) => {
            const parents = [];
            for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent))
                parents.push(parent);
            return parents;
        }),
    );
    for (const directory of directories) {
        const documentation = directory === '.github' ? 'INDEX.md' : 'README.md';
        if (!files.has(`${directory}/${documentation}`))
            errors.push(`${directory}: add ${documentation} describing immediate contents.`);
    }
    for (const [file, source] of files) {
        errors.push(...validateYamlFilename(file));
        if (/^\.github\/readme(?:\.[^/]+)?$/i.test(file))
            errors.push(`${file}: GitHub displays this instead of the root README; use .github/INDEX.md.`);
        if (PLUGIN_HOSTS.some((host) => file.startsWith(`${host.payloadRoot}/dist/`)))
            errors.push(`${file}: retired thin runtime path must not ship.`);
        if (file !== 'tooling/security/dist/check-security.mjs') errors.push(...validateTextStyle(file, source));
        if (/^src\/.+\.(?:ts|mts|cts|mjs|cjs)$/.test(file)) errors.push(...validateRuntimeSource(file, source));
        if (/\.(?:mjs|cjs|js)$/.test(file) && !file.includes('/dist/'))
            errors.push(`${file}: maintained Node code must be TypeScript.`);
        if (
            /^src\/(?:interface|application|domains|adapters|shared|gateway|host-plugins|desktop)\//.test(file) &&
            !files.has(`${path.posix.dirname(file)}/AGENTS.md`)
        )
            errors.push(`${file}: source directory requires local AGENTS.md.`);
        if (/^src\/.+\.ps1$/.test(file)) {
            const uncommented = source
                .split('\n')
                .filter((line) => !line.trim().startsWith('#'))
                .join('\n');
            if (/Stop-Process|taskkill|\.Kill\(/i.test(uncommented))
                errors.push(`${file}: force termination is prohibited.`);
        }
        if (file.startsWith('skills/')) errors.push(`${file}: retired standalone Skill must not ship.`);
        if (/(?:^|\/)(?:utils|helpers)\//.test(file)) errors.push(`${file}: modules need domain ownership.`);
    }
    const packageData: unknown = JSON.parse(files.get('package.json') ?? 'null');
    const plugins: unknown[] = PLUGIN_HOSTS.flatMap((host) => [
        JSON.parse(files.get(`${host.inputRoot}/${host.manifest}`) ?? 'null'),
        JSON.parse(files.get(`${host.payloadRoot}/${host.manifest}`) ?? 'null'),
    ]);
    const skillText = files.get(`${SHARED_PACKAGING_ROOT}/skills/debugging-cdp-targets/SKILL.md`);
    const frontmatter: unknown = parseYaml(skillText?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    if (!isRecord(packageData) || !plugins.every(isRecord) || !isRecord(frontmatter) || !isRecord(frontmatter.metadata))
        return [...errors, 'Malformed repository metadata.'];
    for (const plugin of plugins) {
        if (!isRecord(plugin)) continue;
        errors.push(...validateVersionAgreement(packageData.version, plugin.version, frontmatter.metadata.version));
        if (
            frontmatter.name !== plugin.name ||
            frontmatter.license !== 'MIT' ||
            plugin.license !== 'MIT' ||
            typeof frontmatter.description !== 'string'
        )
            errors.push('Skill/Plugin frontmatter identity, license or description is invalid.');
    }
    for (const host of PLUGIN_HOSTS)
        if (files.get('LICENSE') !== files.get(`${host.payloadRoot}/LICENSE`))
            errors.push(`${host.id}: Root and Plugin MIT licenses must match exactly.`);
    if (!files.get('LICENSE')?.includes('Copyright (c) 2026 Cirnouo')) errors.push('MIT attribution is missing.');
    if (!isRecord(packageData.engines) || packageData.engines.node !== '^24.21.0')
        errors.push('Node supported range drifted: engines.node must be ^24.21.0.');
    if (packageData.packageManager !== 'pnpm@12.4.2')
        errors.push('pnpm pin drifted: packageManager must be pnpm@12.4.2.');
    const ignore = files.get('.gitignore') ?? '';
    for (const pattern of ['.idea/', 'node_modules/', '.env*'])
        if (!ignore.includes(pattern)) errors.push(`Ignore policy missing ${pattern}.`);
    if (
        !files.has('docs/reference/domain-language.md') ||
        files.has('docs/domain-language.md') ||
        files.has('CONTEXT.md')
    )
        errors.push('Use docs/reference/domain-language.md as the only glossary.');
    if (!files.get('CHANGELOG.md')?.includes('## [Unreleased]'))
        errors.push('Changelog requires an Unreleased section.');
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const errors = await auditRepository(process.cwd());
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Repository audit passed.');
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
