import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import { parse as parseYaml } from 'yaml';
import { verifyOfficialPackage } from '../src/adapters/official-package.ts';
import { errorMessage, isRecord } from '../src/shared/errors.ts';
import { PLUGIN_HOSTS, SHARED_PACKAGING_ROOT } from './host-policy.ts';
import { isApprovedIconPath, validateIconPng } from './icon-policy.ts';
import { OFFICIAL_RELEASE } from './payload-policy.ts';
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

function bindingNames(node: Node | null | undefined): string[] {
    if (!node) return [];
    if (node.type === 'Identifier') return [node.name];
    if (node.type === 'RestElement') return bindingNames(node.argument);
    if (node.type === 'AssignmentPattern') return bindingNames(node.left);
    if (node.type === 'ArrayPattern') return node.elements.flatMap(bindingNames);
    if (node.type === 'ObjectPattern')
        return node.properties.flatMap((property) =>
            bindingNames(property.type === 'RestElement' ? property.argument : property.value),
        );
    return [];
}

/** The fixed bridge may reap only the child obtained from its own native spawn. */
function ownedOfficialTermination(ast: ReturnType<typeof parse>): Set<Node> {
    const allowed = new Set<Node>();
    const imports = (name: string, source: string) =>
        ast.program.body.some(
            (node) =>
                node.type === 'ImportDeclaration' &&
                node.importKind !== 'type' &&
                node.source.value === source &&
                node.specifiers.some(
                    (specifier) =>
                        specifier.type === 'ImportSpecifier' &&
                        specifier.importKind !== 'type' &&
                        propertyName(specifier.imported) === name &&
                        specifier.local.name === name,
                ),
        );
    if (!imports('spawn', 'node:child_process') || !imports('resolveServerBin', './official-server.ts')) return allowed;
    const declaration = ast.program.body.find(
        (node) =>
            node.type === 'ExportNamedDeclaration' &&
            node.declaration?.type === 'FunctionDeclaration' &&
            node.declaration.id?.name === 'createOfficialConnection',
    );
    if (declaration?.type !== 'ExportNamedDeclaration' || declaration.declaration?.type !== 'FunctionDeclaration')
        return allowed;
    const body = declaration.declaration.body.body;
    const constant = (name: string) =>
        body
            .filter((node) => node.type === 'VariableDeclaration' && node.kind === 'const')
            .flatMap((node) => (node.type === 'VariableDeclaration' ? node.declarations : []))
            .find((node) => node.id.type === 'Identifier' && node.id.name === name);
    const child = constant('child');
    const bin = constant('bin');
    if (!constant('arguments_') || !child?.init || !bin?.init) return allowed;
    const binValue = expression(bin.init);
    if (binValue.type !== 'LogicalExpression' || binValue.operator !== '??') return allowed;
    const fallback = expression(binValue.right);
    if (
        fallback.type !== 'AwaitExpression' ||
        fallback.argument.type !== 'CallExpression' ||
        fallback.argument.callee.type !== 'Identifier' ||
        fallback.argument.callee.name !== 'resolveServerBin' ||
        fallback.argument.arguments.length !== 0
    )
        return allowed;
    const creation = expression(child.init);
    if (creation.type !== 'CallExpression' || creation.callee.type !== 'Identifier' || creation.callee.name !== 'spawn')
        return allowed;
    const [executable, arguments_, options] = creation.arguments;
    if (
        creation.arguments.length !== 3 ||
        executable?.type !== 'MemberExpression' ||
        executable.computed ||
        executable.object.type !== 'Identifier' ||
        executable.object.name !== 'process' ||
        propertyName(executable.property) !== 'execPath' ||
        arguments_?.type !== 'ArrayExpression' ||
        arguments_.elements.length !== 2 ||
        arguments_.elements[0]?.type !== 'Identifier' ||
        arguments_.elements[0].name !== 'bin' ||
        arguments_.elements[1]?.type !== 'SpreadElement' ||
        arguments_.elements[1].argument.type !== 'Identifier' ||
        arguments_.elements[1].argument.name !== 'arguments_' ||
        options?.type !== 'ObjectExpression' ||
        options.properties.some((property) => property.type !== 'ObjectProperty' || property.computed)
    )
        return allowed;
    const shells = options.properties.filter(
        (property) =>
            property.type === 'ObjectProperty' && !property.computed && propertyName(property.key) === 'shell',
    );
    if (
        shells.length !== 1 ||
        shells[0]?.type !== 'ObjectProperty' ||
        shells[0].value.type !== 'BooleanLiteral' ||
        shells[0].value.value
    )
        return allowed;
    const expected = new Map([
        ['spawn', 1],
        ['resolveServerBin', 1],
        ['child', 1],
        ['bin', 1],
        ['process', 0],
    ]);
    const mutators = new Map([
        ['Object', new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'])],
        ['Reflect', new Set(['set', 'defineProperty', 'deleteProperty', 'setPrototypeOf'])],
    ]);
    const protectedWrite = (node: Node): boolean => {
        const written = expression(node);
        if (written.type === 'MemberExpression' || written.type === 'OptionalMemberExpression')
            return protectedWrite(written.object);
        if (written.type === 'RestElement') return protectedWrite(written.argument);
        if (written.type === 'AssignmentPattern') return protectedWrite(written.left);
        if (written.type === 'ArrayPattern')
            return written.elements.some((element) => element !== null && protectedWrite(element));
        if (written.type === 'ObjectPattern')
            return written.properties.some((property) =>
                protectedWrite(property.type === 'RestElement' ? property.argument : property.value),
            );
        return bindingNames(written).some((name) => expected.has(name));
    };
    const bindings = new Map<string, number>();
    let reassigned = false;
    visit(ast, (node) => {
        let names: string[] = [];
        if (node.type === 'VariableDeclarator') {
            names = bindingNames(node.id);
            const value = node.init && expression(node.init);
            if (value?.type === 'Identifier' && value.name === 'child') reassigned = true;
        } else if (
            node.type === 'ImportSpecifier' ||
            node.type === 'ImportDefaultSpecifier' ||
            node.type === 'ImportNamespaceSpecifier'
        )
            names = bindingNames(node.local);
        else if (node.type === 'CatchClause') names = bindingNames(node.param);
        else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') names = bindingNames(node.id);
        else if (
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression' ||
            node.type === 'ObjectMethod' ||
            node.type === 'ClassMethod' ||
            node.type === 'ClassPrivateMethod'
        ) {
            names = node.params.flatMap(bindingNames);
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')
                names.push(...bindingNames(node.id));
        }
        for (const name of names) bindings.set(name, (bindings.get(name) ?? 0) + 1);
        if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
            if (protectedWrite(node.type === 'AssignmentExpression' ? node.left : node.argument)) reassigned = true;
            if (node.type === 'AssignmentExpression') {
                const value = expression(node.right);
                if (value.type === 'Identifier' && value.name === 'child') reassigned = true;
            }
        }
        if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && protectedWrite(node.left))
            reassigned = true;
        if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
        const callee = expression(node.callee);
        if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return;
        const object = expression(callee.object);
        const method = propertyName(callee.property);
        const target = node.arguments[0];
        if (
            object.type === 'Identifier' &&
            method &&
            mutators.get(object.name)?.has(method) &&
            target &&
            protectedWrite(target)
        )
            reassigned = true;
    });
    if (reassigned || [...expected].some(([name, count]) => (bindings.get(name) ?? 0) !== count)) return allowed;
    const reaper = body.find((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'reapOwnedChild');
    if (reaper?.type !== 'FunctionDeclaration' || !reaper.async || reaper.params.length !== 0) return allowed;
    visit(reaper, (node) => {
        if (
            node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            !node.callee.computed &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'child' &&
            propertyName(node.callee.property) === 'kill' &&
            node.arguments.length === 1 &&
            node.arguments[0]?.type === 'StringLiteral' &&
            ['SIGTERM', 'SIGKILL'].includes(node.arguments[0].value)
        )
            allowed.add(node);
    });
    return allowed;
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
    const ownedTerminations = file === 'src/adapters/mcp-bridge.ts' ? ownedOfficialTermination(ast) : new Set<Node>();
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
                    (file === 'src/adapters/platform-process.ts' &&
                        expression(callee.object).type === 'Identifier' &&
                        propertyName(expression(callee.object)) === 'process' &&
                        ((node.arguments[1]?.type === 'StringLiteral' && node.arguments[1].value === 'SIGTERM') ||
                            (node.arguments[1]?.type === 'NumericLiteral' && node.arguments[1].value === 0))) ||
                    ownedTerminations.has(node)
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
    const officialPrefixes = PLUGIN_HOSTS.map((host) => `${host.payloadRoot}/dist/official-server`);
    const verifiedOfficial = new Set<string>();
    for (const officialPrefix of officialPrefixes) {
        if (!existsSync(path.join(root, officialPrefix))) continue;
        try {
            for (const file of (await verifyOfficialPackage(path.join(root, officialPrefix), OFFICIAL_RELEASE)).keys())
                verifiedOfficial.add(`${officialPrefix}/${file}`);
        } catch (error) {
            errors.push(errorMessage(error));
        }
    }
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
        if (
            officialPrefixes.some(
                (prefix) =>
                    verifiedOfficial.has(`${prefix}/package.json`) &&
                    (directory === prefix || directory.startsWith(`${prefix}/`)),
            )
        )
            continue;
        const documentation = directory === '.github' ? 'INDEX.md' : 'README.md';
        if (!files.has(`${directory}/${documentation}`))
            errors.push(`${directory}: add ${documentation} describing immediate contents.`);
    }
    for (const [file, source] of files) {
        if (verifiedOfficial.has(file)) continue;
        if (/^\.github\/readme(?:\.[^/]+)?$/i.test(file))
            errors.push(`${file}: GitHub displays this instead of the root README; use .github/INDEX.md.`);
        if (
            !PLUGIN_HOSTS.some((host) => file.startsWith(`${host.payloadRoot}/dist/`)) &&
            file !== 'tooling/security/dist/check-security.mjs'
        )
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
    const plugins: unknown[] = PLUGIN_HOSTS.flatMap((host) => [
        JSON.parse(files.get(`${host.inputRoot}/${host.manifest}`) ?? 'null'),
        JSON.parse(files.get(`${host.payloadRoot}/${host.manifest}`) ?? 'null'),
    ]);
    const skillText = files.get(`${SHARED_PACKAGING_ROOT}/skills/debugging-cdp-targets/SKILL.md`);
    const frontmatter: unknown = parseYaml(skillText?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    if (
        !isRecord(packageData) ||
        !isRecord(packageData.engines) ||
        !plugins.every(isRecord) ||
        !isRecord(frontmatter) ||
        !isRecord(frontmatter.metadata)
    )
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
