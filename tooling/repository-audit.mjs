import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { parse as parseYaml } from 'yaml';
import { PLUGIN_ROOT } from './payload-policy.mjs';

export function validateTextStyle(file, source) {
    const errors = [];
    if (source.includes('\r')) errors.push(`${file}: use LF, not CRLF.`);
    if (source.includes('\t')) errors.push(`${file}: tabs are prohibited.`);
    if (source && !source.endsWith('\n')) errors.push(`${file}: add a final newline.`);
    if (file !== 'pnpm-lock.yaml' && /\.(?:json|yaml|yml|ps1|toml|sh)$/.test(file)) {
        source.split('\n').forEach((line, index) => {
            if (/^ +\S/.test(line) && line.match(/^ */)[0].length % 4)
                errors.push(`${file}:${index + 1}: indentation must be a multiple of four.`);
        });
    }
    return errors;
}

function visit(node, callback) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') callback(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) visit(child, callback);
        else if (value && typeof value === 'object') visit(value, callback);
    }
}

export function validateRuntimeSource(file, source) {
    const errors = [];
    let ast;
    try {
        ast = parse(source, { ecmaVersion: 'latest', sourceType: file.endsWith('.cjs') ? 'script' : 'module' });
    } catch (error) {
        return [`${file}: invalid JavaScript: ${error.message}`];
    }
    const layer = file.split('/')[1];
    const domain = layer === 'domains';
    const entry = ['src/interface/control.mjs', 'src/interface/mcp-bootstrap.mjs'].includes(file);
    function dependency(specifier) {
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
        if (!specifier.startsWith('.') && !specifier.startsWith('node:') && specifier !== 'ws')
            errors.push(`${file}: unapproved runtime dependency: ${specifier}`);
    }
    visit(ast, (node) => {
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source)
            dependency(node.source.value);
        if (node.type === 'ImportExpression')
            dependency(node.source.type === 'Literal' ? node.source.value : undefined);
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require')
            dependency(node.arguments[0]?.value);
        if (domain && node.type === 'MemberExpression' && node.object.name === 'process')
            errors.push(`${file}: domains cannot access process state.`);
        if (
            !entry &&
            node.type === 'MemberExpression' &&
            node.object.name === 'process' &&
            node.property.name === 'argv'
        )
            errors.push(`${file}: CLI parsing belongs only in composition roots.`);
        if (
            node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'kill'
        ) {
            if (
                !(
                    file === 'src/adapters/platform-process.mjs' &&
                    node.callee.object.name === 'process' &&
                    node.arguments[1]?.value === 'SIGTERM'
                )
            )
                errors.push(`${file}: unapproved process termination API.`);
        }
        if (
            node.type === 'Literal' &&
            typeof node.value === 'string' &&
            /session\.json|--categoryPwa|--viaCli|obsidian-devtools/.test(node.value)
        )
            errors.push(`${file}: retired or forbidden runtime contract.`);
    });
    if (source.startsWith('#!') && !entry) errors.push(`${file}: only composition roots may be executable.`);
    return errors;
}

export function auditRepository(root) {
    const errors = [];
    const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((file) => file && existsSync(path.join(root, file)));
    const files = new Map(paths.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]));
    const directories = new Set(
        paths.flatMap((file) => {
            const parents = [];
            for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent))
                parents.push(parent);
            return parents;
        }),
    );
    for (const directory of directories)
        if (!files.has(`${directory}/README.md`))
            errors.push(`${directory}: add README.md describing immediate contents.`);
    for (const [file, source] of files) {
        if (!file.startsWith(`${PLUGIN_ROOT}/dist/`)) errors.push(...validateTextStyle(file, source));
        if (/^src\/.+\.(?:mjs|cjs)$/.test(file)) errors.push(...validateRuntimeSource(file, source));
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
    const link = path.join(root, 'CLAUDE.md');
    if (!existsSync(link) || !lstatSync(link).isSymbolicLink() || readlinkSync(link) !== 'AGENTS.md')
        errors.push('CLAUDE.md must be a real relative symlink to AGENTS.md.');
    const mode = execFileSync('git', ['ls-files', '-s', 'CLAUDE.md'], { cwd: root, encoding: 'utf8' });
    if (!mode.startsWith('120000 ')) errors.push('CLAUDE.md must have Git mode 120000.');
    const packageData = JSON.parse(files.get('package.json'));
    const plugin = JSON.parse(files.get(`${PLUGIN_ROOT}/plugin.json`));
    const skillText = files.get(`${PLUGIN_ROOT}/skills/debugging-cdp-targets/SKILL.md`);
    const frontmatter = parseYaml(skillText.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    if (
        packageData.version !== '0.1.0' ||
        plugin.version !== packageData.version ||
        frontmatter?.metadata?.version !== packageData.version
    )
        errors.push('Package, Plugin, and Skill versions must agree at unreleased 0.1.0.');
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
        const errors = auditRepository(process.cwd());
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Repository audit passed.');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
