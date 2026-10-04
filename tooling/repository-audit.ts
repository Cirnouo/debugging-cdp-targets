import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import { parse as parseYaml } from 'yaml';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { errorMessage, isRecord } from '../src/shared/errors.ts';
import { OFFICIAL_RELEASE, PLUGIN_ROOT } from './payload-policy.ts';
import { validateVersionAgreement } from './version-policy.ts';

export function validateTextStyle(file: string, source: string) {
    const errors = [];
    if (source.includes('\r')) errors.push(`${file}: use LF, not CRLF.`);
    if (source.includes('\t')) errors.push(`${file}: tabs are prohibited.`);
    if (source && !source.endsWith('\n')) errors.push(`${file}: add a final newline.`);
    if (
        !['pnpm-lock.yaml', 'tooling/security/upstream-pnpm-lock.yaml'].includes(file) &&
        /\.(?:json|yaml|yml|ps1|toml|sh)$/.test(file)
    ) {
        source.split('\n').forEach((line, index) => {
            if (/^ +\S/.test(line) && (line.match(/^ */)?.[0].length ?? 0) % 4)
                errors.push(`${file}:${index + 1}: indentation must be a multiple of four.`);
        });
    }
    return errors;
}

function visit(node: unknown, callback: (node: Node) => void) {
    if (!node || typeof node !== 'object') return;
    // Only traverse parser-produced nodes; comments also carry a type field.
    if ('type' in node && typeof node.type === 'string' && !node.type.startsWith('Comment')) callback(node as Node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) visit(child, callback);
        else if (value && typeof value === 'object') visit(value, callback);
    }
}

function expression(node: Node): Node {
    while (
        node.type === 'TSAsExpression' ||
        node.type === 'TSTypeAssertion' ||
        node.type === 'TSNonNullExpression' ||
        node.type === 'TSSatisfiesExpression' ||
        node.type === 'ParenthesizedExpression'
    )
        node = node.expression;
    return node;
}
function propertyName(node: Node): string | undefined {
    return node.type === 'Identifier' ? node.name : node.type === 'StringLiteral' ? node.value : undefined;
}

export function validateRuntimeSource(file: string, source: string) {
    const errors = [];
    let ast: ReturnType<typeof parse>;
    try {
        ast = parse(source, {
            sourceType: file.endsWith('.cjs') ? 'script' : 'module',
            plugins: ['typescript'],
            createImportExpressions: true,
        });
    } catch (error) {
        return [`${file}: invalid source: ${error instanceof Error ? error.message : String(error)}`];
    }
    const layer = file.split('/')[1];
    const domain = layer === 'domains';
    const entry = file === 'src/interface/mcp-bootstrap.ts';
    function dependency(specifier: unknown) {
        if (typeof specifier !== 'string') {
            errors.push(`${file}: computed module dependencies are prohibited.`);
            return;
        }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (domain && (!specifier.startsWith('.') || !/^src\/(?:domains|shared)\//.test(resolved))) {
            errors.push(`${file}: domains may depend only on domains and shared.`);
        }
        if (layer === 'adapters' && /^src\/(?:application|interface)\//.test(resolved))
            errors.push(`${file}: adapter depends on an upper layer.`);
        if (layer === 'shared' && specifier.startsWith('.') && !resolved.startsWith('src/shared/'))
            errors.push(`${file}: shared cannot depend on other layers.`);
        if (layer === 'application' && resolved.startsWith('src/interface/'))
            errors.push(`${file}: application cannot depend on interface.`);
        if (
            !specifier.startsWith('.') &&
            !specifier.startsWith('node:') &&
            specifier !== 'ws' &&
            ![
                '@modelcontextprotocol/client',
                '@modelcontextprotocol/server',
                '@modelcontextprotocol/core',
                '@modelcontextprotocol/client/stdio',
                '@modelcontextprotocol/server/stdio',
            ].includes(specifier)
        )
            errors.push(`${file}: unapproved runtime dependency: ${specifier}`);
    }
    visit(ast, (node) => {
        const object =
            node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression'
                ? expression(node.object)
                : undefined;
        const callee =
            node.type === 'CallExpression' || node.type === 'OptionalCallExpression'
                ? expression(node.callee)
                : undefined;
        if (
            (node.type === 'ImportDeclaration' ||
                node.type === 'ExportNamedDeclaration' ||
                node.type === 'ExportAllDeclaration') &&
            node.source
        )
            dependency(node.source.value);
        if (node.type === 'ImportExpression')
            dependency(node.source.type === 'StringLiteral' ? node.source.value : undefined);
        if (node.type === 'TSImportType') dependency(node.argument.value);
        if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference')
            dependency(
                node.moduleReference.expression.type === 'StringLiteral'
                    ? node.moduleReference.expression.value
                    : undefined,
            );
        if (
            (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
            callee?.type === 'Identifier' &&
            callee.name === 'require'
        )
            dependency(node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : undefined);
        if (domain && object?.type === 'Identifier' && object.name === 'process')
            errors.push(`${file}: domains cannot access process state.`);
        if (
            !entry &&
            (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
            object?.type === 'Identifier' &&
            object.name === 'process' &&
            propertyName(node.property) === 'argv'
        )
            errors.push(`${file}: CLI parsing belongs only in composition roots.`);
        if (
            (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
            (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') &&
            propertyName(callee.property) === 'kill'
        ) {
            if (
                !(
                    file === 'src/adapters/platform-process.ts' &&
                    expression(callee.object).type === 'Identifier' &&
                    propertyName(expression(callee.object)) === 'process' &&
                    ((node.arguments[1]?.type === 'StringLiteral' && node.arguments[1].value === 'SIGTERM') ||
                        (node.arguments[1]?.type === 'NumericLiteral' && node.arguments[1].value === 0))
                )
            )
                errors.push(`${file}: unapproved process termination API.`);
        }
        if (node.type === 'StringLiteral' && /session\.json|--categoryPwa|--viaCli|obsidian-devtools/.test(node.value))
            errors.push(`${file}: retired or forbidden runtime contract.`);
    });
    if (source.startsWith('#!') && !entry) errors.push(`${file}: only composition roots may be executable.`);
    return errors;
}

export async function auditRepository(root: string) {
    const errors = [];
    const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((file) => file && existsSync(path.join(root, file)));
    const officialPrefix = `${PLUGIN_ROOT}/dist/official-server`;
    const verifiedOfficial = new Set<string>();
    if (existsSync(path.join(root, officialPrefix))) {
        try {
            for (const file of (await verifyOfficialPackage(path.join(root, officialPrefix), OFFICIAL_RELEASE)).keys())
                verifiedOfficial.add(`${officialPrefix}/${file}`);
        } catch (error) {
            errors.push(errorMessage(error));
        }
    }
    const files = new Map(paths.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]));
    const directories = new Set(
        paths.flatMap((file) => {
            const parents = [];
            for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent))
                parents.push(parent);
            return parents;
        }),
    );
    for (const directory of directories) {
        if (verifiedOfficial.size && (directory === officialPrefix || directory.startsWith(`${officialPrefix}/`)))
            continue;
        const documentation = directory === '.github' ? 'INDEX.md' : 'README.md';
        if (!files.has(`${directory}/${documentation}`))
            errors.push(`${directory}: add ${documentation} describing immediate contents.`);
    }
    for (const [file, source] of files) {
        if (verifiedOfficial.has(file)) continue;
        if (/^\.github\/readme(?:\.[^/]+)?$/i.test(file))
            errors.push(`${file}: GitHub displays this instead of the root README; use .github/INDEX.md.`);
        if (!file.startsWith(`${PLUGIN_ROOT}/dist/`) && file !== 'tooling/security/dist/check-security.mjs')
            errors.push(...validateTextStyle(file, source));
        if (/^src\/.+\.(?:ts|mts|cts|mjs|cjs)$/.test(file)) errors.push(...validateRuntimeSource(file, source));
        if (/\.(?:mjs|cjs|js)$/.test(file) && !file.includes('/dist/'))
            errors.push(`${file}: maintained Node code must be TypeScript.`);
        if (
            /^src\/(?:interface|application|domains|adapters|shared)\//.test(file) &&
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
    const plugin: unknown = JSON.parse(files.get(`${PLUGIN_ROOT}/.codex-plugin/plugin.json`) ?? 'null');
    const skillText = files.get(`${PLUGIN_ROOT}/skills/debugging-cdp-targets/SKILL.md`);
    const frontmatter: unknown = parseYaml(skillText?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    if (
        !isRecord(packageData) ||
        !isRecord(packageData.engines) ||
        !isRecord(plugin) ||
        !isRecord(frontmatter) ||
        !isRecord(frontmatter.metadata)
    )
        return [...errors, 'Malformed repository metadata.'];
    errors.push(...validateVersionAgreement(packageData.version, plugin.version, frontmatter.metadata.version));
    if (
        frontmatter?.name !== plugin.name ||
        frontmatter?.license !== 'MIT' ||
        typeof frontmatter?.description !== 'string'
    )
        errors.push('Skill frontmatter identity or description is invalid.');
    if (files.get('LICENSE') !== files.get(`${PLUGIN_ROOT}/LICENSE`))
        errors.push('Root and Plugin MIT licenses must match exactly.');
    if (!files.get('LICENSE')?.includes('Copyright (c) 2026 Cirnouo')) errors.push('MIT attribution is missing.');
    if (packageData.packageManager !== 'pnpm@12.4.2' || packageData.engines.node !== '24.21.0')
        errors.push('Pinned toolchain drifted.');
    const ignore = files.get('.gitignore') ?? '';
    for (const pattern of ['.idea/', 'node_modules/', '.env*'])
        if (!ignore.includes(pattern)) errors.push(`Ignore policy missing ${pattern}.`);
    if (!files.has('docs/domain-language.md') || files.has('CONTEXT.md'))
        errors.push('Use docs/domain-language.md as the only glossary.');
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
