import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

import { SKILL_ROOT, validatePayloadFileInventory } from './payload-policy.mjs';

const EXPECTED_VERSION = '0.1.0';
const EXPECTED_NODE = '24.21.0';
const EXPECTED_PNPM = '12.4.2';
const EXPECTED_DEV_DEPENDENCIES = Object.freeze({
    '@biomejs/biome': '2.5.14',
    '@commitlint/cli': '21.2.2',
    '@commitlint/config-conventional': '21.2.2',
    husky: '9.1.7',
    'lint-staged': '17.5.1',
    skills: '1.6.0',
    yaml: '2.9.1',
});
const APPROVED_STATE_FIELDS = Object.freeze([
    'schemaVersion',
    'status',
    'targetAdapter',
    'executablePath',
    'rootProcessId',
    'port',
    'browserProduct',
    'browserMajorVersion',
    'webSocketDebuggerUrl',
    'requestedPackageSpec',
    'resolvedPackageVersion',
    'extensionsEnabled',
    'workspaces',
    'startedAtUtc',
    'daemonProcessId',
]);
const maintainedTextExtensions = new Set([
    '',
    '.cjs',
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    '.js',
    '.json',
    '.md',
    '.mjs',
    '.ps1',
    '.psd1',
    '.psm1',
    '.sh',
    '.toml',
    '.yaml',
    '.yml',
]);
const structurallyIndentedExtensions = new Set(['.json', '.ps1', '.psd1', '.psm1', '.sh', '.toml', '.yaml', '.yml']);
const exemptDirectoryPrefixes = ['.git', '.husky/_', 'node_modules', 'coverage', 'test-results'];

function normalize(filePath) {
    return filePath.replaceAll('\\', '/');
}

function isExemptDirectory(directory) {
    return exemptDirectoryPrefixes.some((prefix) => directory === prefix || directory.startsWith(`${prefix}/`));
}

function isMapping(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseYamlMapping(source, label, errors) {
    let document;
    try {
        document = parseDocument(source, { merge: false, uniqueKeys: true });
    } catch (error) {
        errors.push(`${label} must be valid YAML: ${error.message}`);
        return null;
    }
    if (document.errors.length > 0) {
        errors.push(`${label} must be valid YAML: ${document.errors.map((error) => error.message).join('; ')}`);
        return null;
    }
    const value = document.toJS({ maxAliasCount: 0 });
    if (!isMapping(value)) {
        errors.push(`${label} must be a YAML mapping.`);
        return null;
    }
    return value;
}

function parseSkillFrontmatter(source, errors) {
    const match = source.match(/^---\n(?<frontmatter>[\s\S]*?)\n---(?:\n|$)/);
    if (!match) {
        errors.push('Skill frontmatter must be present and delimited by YAML fences.');
        return null;
    }
    return parseYamlMapping(match.groups.frontmatter, 'Skill frontmatter YAML', errors);
}

function auditMappingKeys(value, allowedKeys, label, errors) {
    if (!isMapping(value)) return;
    const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
    if (unsupported.length > 0) {
        errors.push(`${label} contains unsupported key(s): ${unsupported.join(', ')}.`);
    }
}

const JAVASCRIPT_LEXICAL_UNCERTAINTY = '__REPOSITORY_AUDIT_UNCERTAIN_SLASH__';

function classifyRegularExpressionContext(prefix) {
    const trimmed = prefix.trimEnd();
    if (trimmed.length === 0) return 'regex';
    if (trimmed.endsWith('++') || trimmed.endsWith('--')) return 'division';
    if ('([{:;,=!?&|+-*%^~<>/'.includes(trimmed.at(-1))) return 'regex';
    if (trimmed.endsWith('}')) return 'ambiguous';
    if (trimmed.endsWith(')')) {
        if (["'", '"', '`', '/'].some((token) => trimmed.includes(token))) return 'ambiguous';
        let depth = 0;
        for (let index = trimmed.length - 1; index >= 0; index -= 1) {
            if (trimmed[index] === ')') {
                depth += 1;
            } else if (trimmed[index] === '(') {
                depth -= 1;
                if (depth === 0) {
                    const beforeParenthesis = trimmed.slice(0, index).trimEnd();
                    return /\b(?:catch|for(?:\s+await)?|if|switch|while|with)$/.test(beforeParenthesis)
                        ? 'regex'
                        : 'division';
                }
            }
        }
        return 'ambiguous';
    }
    return /\b(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)$/.test(trimmed)
        ? 'regex'
        : 'division';
}

function stripJavaScriptComments(source) {
    let result = '';
    let state = 'code';
    let regularExpressionClass = false;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        if (state === 'line-comment') {
            if (character === '\n') {
                result += '\n';
                state = 'code';
            } else {
                result += ' ';
            }
            continue;
        }
        if (state === 'block-comment') {
            if (character === '*' && next === '/') {
                result += '  ';
                index += 1;
                state = 'code';
            } else {
                result += character === '\n' ? '\n' : ' ';
            }
            continue;
        }
        if (state === 'regular-expression') {
            result += character;
            if (character === '\\' && next !== undefined) {
                result += next;
                index += 1;
            } else if (character === '[') {
                regularExpressionClass = true;
            } else if (character === ']') {
                regularExpressionClass = false;
            } else if (character === '/' && !regularExpressionClass) {
                state = 'code';
            }
            continue;
        }
        if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
            result += character;
            if (character === '\\' && next !== undefined) {
                result += next;
                index += 1;
                continue;
            }
            if (
                (state === 'single-quote' && character === "'") ||
                (state === 'double-quote' && character === '"') ||
                (state === 'template' && character === '`')
            ) {
                state = 'code';
            }
            continue;
        }
        if (character === '/' && next === '/') {
            result += '  ';
            index += 1;
            state = 'line-comment';
        } else if (character === '/' && next === '*') {
            result += '  ';
            index += 1;
            state = 'block-comment';
        } else if (character === '/') {
            const context = classifyRegularExpressionContext(result);
            if (context === 'regex') {
                result += character;
                regularExpressionClass = false;
                state = 'regular-expression';
            } else {
                result += context === 'ambiguous' ? `${JAVASCRIPT_LEXICAL_UNCERTAINTY}/` : character;
            }
        } else {
            result += character;
            if (character === "'") state = 'single-quote';
            if (character === '"') state = 'double-quote';
            if (character === '`') state = 'template';
        }
    }
    return result;
}

function javascriptSyntaxView(source) {
    const uncommented = stripJavaScriptComments(source);
    let result = '';
    let state = 'code';
    let regularExpressionClass = false;
    for (let index = 0; index < uncommented.length; index += 1) {
        const character = uncommented[index];
        const next = uncommented[index + 1];
        if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
            if (character === '\\' && uncommented[index + 1] !== undefined) {
                result += '  ';
                index += 1;
            } else {
                result += character === '\n' ? '\n' : ' ';
                if (
                    (state === 'single-quote' && character === "'") ||
                    (state === 'double-quote' && character === '"') ||
                    (state === 'template' && character === '`')
                ) {
                    state = 'code';
                }
            }
            continue;
        }
        if (state === 'regular-expression') {
            result += character === '\n' ? '\n' : ' ';
            if (character === '\\' && next !== undefined) {
                result += ' ';
                index += 1;
            } else if (character === '[') {
                regularExpressionClass = true;
            } else if (character === ']') {
                regularExpressionClass = false;
            } else if (character === '/' && !regularExpressionClass) {
                state = 'code';
            }
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            result += 'x';
            state = character === "'" ? 'single-quote' : character === '"' ? 'double-quote' : 'template';
        } else if (character === '/') {
            const context = classifyRegularExpressionContext(result);
            if (context === 'regex') {
                result += 'x';
                regularExpressionClass = false;
                state = 'regular-expression';
            } else {
                result += context === 'ambiguous' ? JAVASCRIPT_LEXICAL_UNCERTAINTY : character;
            }
        } else {
            result += character;
        }
    }
    return result;
}

function stripPowerShellComments(source) {
    let result = '';
    let state = 'code';
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        if (state === 'line-comment') {
            if (character === '\n') {
                result += '\n';
                state = 'code';
            } else {
                result += ' ';
            }
            continue;
        }
        if (state === 'block-comment') {
            if (character === '#' && next === '>') {
                result += '  ';
                index += 1;
                state = 'code';
            } else {
                result += character === '\n' ? '\n' : ' ';
            }
            continue;
        }
        if (state === 'single-quote' || state === 'double-quote') {
            result += character;
            if (state === 'single-quote' && character === "'" && next === "'") {
                result += next;
                index += 1;
                continue;
            }
            if (state === 'double-quote' && character === '`' && next !== undefined) {
                result += next;
                index += 1;
                continue;
            }
            if ((state === 'single-quote' && character === "'") || (state === 'double-quote' && character === '"')) {
                state = 'code';
            }
            continue;
        }
        if (character === '<' && next === '#') {
            result += '  ';
            index += 1;
            state = 'block-comment';
        } else if (character === '#') {
            result += ' ';
            state = 'line-comment';
        } else {
            result += character;
            if (character === "'") state = 'single-quote';
            if (character === '"') state = 'double-quote';
        }
    }
    return result;
}

function isJavaScriptRuntime(filePath) {
    return ['.cjs', '.js', '.mjs'].includes(path.posix.extname(filePath));
}

function isExecutableRuntime(filePath) {
    return ['.cjs', '.js', '.mjs', '.ps1', '.psd1', '.psm1', '.sh'].includes(path.posix.extname(filePath));
}

function sourceWithoutComments(filePath, source) {
    if (isJavaScriptRuntime(filePath)) return stripJavaScriptComments(source);
    if (['.ps1', '.psd1', '.psm1'].includes(path.posix.extname(filePath))) {
        return stripPowerShellComments(source);
    }
    return source;
}

function dynamicImportArguments(source) {
    const arguments_ = [];
    const starts = source.matchAll(/\bimport\s*\(/g);
    for (const start of starts) {
        const opening = source.indexOf('(', start.index);
        let depth = 1;
        let quote = null;
        for (let index = opening + 1; index < source.length; index += 1) {
            const character = source[index];
            if (quote !== null) {
                if (character === '\\' && source[index + 1] !== undefined) {
                    index += 1;
                } else if (character === quote) {
                    quote = null;
                }
                continue;
            }
            if (character === "'" || character === '"' || character === '`') {
                quote = character;
            } else if (character === '(') {
                depth += 1;
            } else if (character === ')') {
                depth -= 1;
                if (depth === 0) {
                    arguments_.push(source.slice(opening + 1, index).trim());
                    break;
                }
            }
        }
    }
    return arguments_;
}

function moduleSpecifiers(source) {
    const specifiers = [];
    const patterns = [
        /\bimport\s*(?!\s*\()(?:(?:[^;"']|\n)*?\bfrom\s*)?["']([^"']+)["']/g,
        /\bexport\s*(?:\*\s*(?:as\s+[$\w]+\s*)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
    }
    const nonStaticDynamicImports = [];
    for (const argument of dynamicImportArguments(source)) {
        const quoted = /^(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')$/.exec(argument);
        const templated = /^`([^`$\\]*(?:\\.[^`$\\]*)*)`$/.exec(argument);
        const specifier = quoted?.[1] ?? quoted?.[2] ?? templated?.[1];
        if (specifier === undefined) {
            nonStaticDynamicImports.push(argument);
        } else {
            specifiers.push(specifier);
        }
    }
    return {
        escapedSpecifiers: [...new Set(specifiers.filter((specifier) => specifier.includes('\\')))],
        nonStaticDynamicImports,
        specifiers: [...new Set(specifiers)],
    };
}

function isApprovedComputedDynamicImport(filePath, argument) {
    if (filePath !== `${SKILL_ROOT}/scripts/adapters/official-cli.mjs`) return false;
    return [
        'pathToFileURL(runtime.clientModule).href',
        'pathToFileURL(runtime.daemonUtilsModule).href',
        'pathToFileURL(runtime.commandSchemaModule).href',
    ].includes(argument.replaceAll(/\s/g, ''));
}

function resolveRuntimeLayer(filePath, specifier) {
    if (!specifier.startsWith('.')) return null;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier));
    const relative = resolved.slice(`${SKILL_ROOT}/scripts/`.length);
    const [layer] = relative.split('/');
    return ['adapters', 'application', 'domains', 'interface', 'shared'].includes(layer) ? layer : null;
}

function isForbiddenDomainDependency(specifier) {
    const normalized = specifier.replace(/^node:/, '');
    const root = normalized.split('/')[0];
    return (
        ['child_process', 'fs', 'http', 'https', 'net', 'os', 'process'].includes(root) || /powershell/i.test(specifier)
    );
}

function hasDirectExecutionGuard(source) {
    if (/\bimport\.meta\.main\b/.test(source)) return true;
    if (/\b(?:require\.main\s*={2,3}\s*module|module\s*={2,3}\s*require\.main)\b/.test(source)) return true;
    if (/\bimport\.meta\.url\s*={2,3}/.test(source) || /={2,3}\s*import\.meta\.url\b/.test(source)) return true;
    return (
        /fileURLToPath\s*\(\s*import\.meta\.url\s*\)/.test(source) &&
        /process\.argv\s*\[\s*1\s*]/.test(source) &&
        /(?:={2,3}|!==?)/.test(source)
    );
}

function hasTerminationApi(source) {
    if (/\b(?:Stop-Process|taskkill(?:\.exe)?|tskill(?:\.exe)?|TerminateProcess|TerminateJobObject)\b/i.test(source)) {
        return true;
    }
    for (const match of source.matchAll(/\.kill\s*\(([^)]*)\)/gi)) {
        const prefix = source.slice(Math.max(0, match.index - 32), match.index);
        const arguments_ = match[1].split(',').map((argument) => argument.trim());
        if (/\bprocess\s*$/.test(prefix) && arguments_.length >= 2 && arguments_[1] === '0') continue;
        return true;
    }
    const importedBindings = new Set();
    for (const match of source.matchAll(
        /\bimport\s*(?:[$\w]+\s*,\s*)?\{([^}]*)\}\s*from\s*["'](?:node:)?process["']/g,
    )) {
        for (const imported of match[1].split(',')) {
            const binding = /^\s*kill(?:\s+as\s+([$\w]+))?\s*$/.exec(imported);
            if (binding) importedBindings.add(binding[1] ?? 'kill');
        }
    }
    for (const binding of importedBindings) {
        const escapedBinding = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const calls = new RegExp(`\\b${escapedBinding}\\s*\\(([^)]*)\\)`, 'g');
        for (const match of source.matchAll(calls)) {
            const arguments_ = match[1].split(',').map((argument) => argument.trim());
            if (arguments_.length >= 2 && arguments_[1] === '0') continue;
            return true;
        }
    }
    return false;
}

function externalNetworkLiteral(source) {
    for (const match of source.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
        const address = match[0];
        if (net.isIP(address) === 4 && address !== '127.0.0.1') return address;
    }
    for (const match of source.matchAll(/["'`]([^"'`\r\n]+)["'`]/g)) {
        const value = match[1].replace(/^\[|]$/g, '');
        if (net.isIP(value) === 6 && value !== '::1') return value;
    }
    return null;
}

function legacyIdentifiers() {
    return [
        ['debugging', 'chromium', 'apps'].join('-'),
        ['chromium', 'devtools', 'session'].join('-'),
        `--${['target', 'kind'].join('-')}`,
        ['target', 'Kind'].join(''),
        ['Target', 'Kind'].join(''),
        ['Chromium', 'App'].join(''),
        ['agent', 'debugging', 'chromium', 'apps'].join('-'),
    ];
}

export function validateTextStyle(filePath, source) {
    const errors = [];
    const extension =
        path.posix.extname(filePath) || path.posix.basename(filePath).startsWith('.')
            ? path.posix.extname(filePath) || path.posix.basename(filePath)
            : '';
    if (!maintainedTextExtensions.has(extension) && !filePath.startsWith('.husky/')) {
        return errors;
    }
    if (source.includes('\t')) {
        errors.push(`${filePath}: maintained text must not contain tabs.`);
    }
    if (source.includes('\r')) {
        errors.push(`${filePath}: maintained text must use LF, not CRLF or CR.`);
    }
    if (source.length > 0 && !source.endsWith('\n')) {
        errors.push(`${filePath}: maintained text must end with a final newline.`);
    }
    if (
        filePath !== 'pnpm-lock.yaml' &&
        (structurallyIndentedExtensions.has(extension) || (filePath.startsWith('.husky/') && extension === ''))
    ) {
        const badLine = source
            .split('\n')
            .findIndex((line) => /^ +\S/.test(line) && line.match(/^ */)[0].length % 4 !== 0);
        if (badLine >= 0) {
            errors.push(`${filePath}:${badLine + 1}: structural indentation must use four-space increments.`);
        }
    }
    return errors;
}

function auditDirectories(snapshot, errors) {
    const tracked = new Set(snapshot.trackedFiles.map(normalize));
    const directories = new Set();
    for (const filePath of tracked) {
        let directory = path.posix.dirname(filePath);
        while (directory !== '.') {
            if (!isExemptDirectory(directory)) {
                directories.add(directory);
            }
            directory = path.posix.dirname(directory);
        }
    }
    for (const directory of [...directories].sort()) {
        if (!tracked.has(`${directory}/README.md`)) {
            errors.push(`${directory}: tracked human-maintained directory is missing README.md.`);
        }
    }
}

function auditSymlink(snapshot, errors) {
    if (snapshot.trackedModes['CLAUDE.md'] !== '120000') {
        errors.push('CLAUDE.md must be a Git mode 120000 symlink.');
    }
    if (snapshot.symlinks['CLAUDE.md'] !== 'AGENTS.md') {
        errors.push('CLAUDE.md must target the relative path AGENTS.md.');
    }
}

function auditVersions(files, skillMetadata, errors) {
    let packageData;
    try {
        packageData = JSON.parse(files['package.json'] ?? '');
    } catch (error) {
        errors.push(`package.json must be valid JSON: ${error.message}`);
        return;
    }
    const changelog = files['CHANGELOG.md'] ?? '';
    const mise = files['mise.toml'] ?? '';
    const actual = {
        'package version': packageData.version,
        'Skill version': skillMetadata?.metadata?.version,
        'changelog version': changelog.match(/^## \[(\d+\.\d+\.\d+)]/m)?.[1],
        'package Node engine': packageData.engines?.node,
        'mise Node version': mise.match(/^node\s*=\s*["']([^"']+)["']/m)?.[1],
        'package manager': packageData.packageManager,
        'mise pnpm version': mise.match(/^pnpm\s*=\s*["']([^"']+)["']/m)?.[1],
    };
    const expected = {
        'package version': EXPECTED_VERSION,
        'Skill version': EXPECTED_VERSION,
        'changelog version': EXPECTED_VERSION,
        'package Node engine': EXPECTED_NODE,
        'mise Node version': EXPECTED_NODE,
        'package manager': `pnpm@${EXPECTED_PNPM}`,
        'mise pnpm version': EXPECTED_PNPM,
    };
    for (const [label, expectedValue] of Object.entries(expected)) {
        if (actual[label] !== expectedValue) {
            errors.push(`Version mismatch: ${label} must be ${expectedValue}; found ${actual[label] ?? 'missing'}.`);
        }
    }
    if (packageData.name !== 'debugging-cdp-targets') {
        errors.push('Package name must be debugging-cdp-targets.');
    }
    if (packageData.private !== true) {
        errors.push('Package must be private.');
    }
    if (packageData.type !== 'module') {
        errors.push('Package must use ESM with type module.');
    }
    if (packageData.license !== 'MIT') {
        errors.push('Package license must be MIT.');
    }
    if (packageData.dependencies && Object.keys(packageData.dependencies).length > 0) {
        errors.push('Package must not declare runtime dependencies.');
    }
    const devDependencies = packageData.devDependencies ?? {};
    const dependencyNames = new Set([...Object.keys(EXPECTED_DEV_DEPENDENCIES), ...Object.keys(devDependencies)]);
    const dependencyMismatches = [...dependencyNames]
        .sort()
        .filter((name) => devDependencies[name] !== EXPECTED_DEV_DEPENDENCIES[name]);
    if (dependencyMismatches.length > 0) {
        errors.push(
            `Package dev dependencies must match the pinned inventory; mismatched: ${dependencyMismatches.join(', ')}.`,
        );
    }
}

function auditLicenses(files, errors) {
    if (typeof files.LICENSE !== 'string' || files.LICENSE.length === 0) {
        errors.push('Root LICENSE is required.');
    }
    if (typeof files[`${SKILL_ROOT}/LICENSE`] !== 'string' || files[`${SKILL_ROOT}/LICENSE`].length === 0) {
        errors.push('Payload LICENSE is required.');
    }
    if (files.LICENSE !== files[`${SKILL_ROOT}/LICENSE`]) {
        errors.push('Root and production payload MIT licenses must be byte-identical.');
    }
}

function auditRuntime(files, errors) {
    const runtimeEntries = Object.entries(files).filter(([filePath]) => filePath.startsWith(`${SKILL_ROOT}/scripts/`));
    const entryPath = `${SKILL_ROOT}/scripts/cdp-session.mjs`;
    const entrySource = files[entryPath];
    if (typeof entrySource !== 'string' || entrySource.length === 0) {
        errors.push('scripts/cdp-session.mjs is the required public entry.');
    } else {
        if (!entrySource.startsWith('#!/usr/bin/env node\n')) {
            errors.push('scripts/cdp-session.mjs must retain its Node shebang.');
        }
        if (!hasDirectExecutionGuard(javascriptSyntaxView(entrySource))) {
            errors.push('scripts/cdp-session.mjs must retain a direct-execution guard.');
        }
    }
    for (const [filePath, source] of runtimeEntries) {
        if (!isExecutableRuntime(filePath)) continue;
        const inspectedSource = sourceWithoutComments(filePath, source);
        if (inspectedSource.includes(JAVASCRIPT_LEXICAL_UNCERTAINTY)) {
            errors.push(
                `${filePath}: JavaScript slash syntax is ambiguous to the repository audit; rewrite it into an explicit statement before merging.`,
            );
        }
        const isEntry = filePath === entryPath;
        const syntaxSource = isJavaScriptRuntime(filePath) ? javascriptSyntaxView(source) : inspectedSource;
        const hasExecutableMarker = source.startsWith('#!') || hasDirectExecutionGuard(syntaxSource);
        if (hasExecutableMarker && !isEntry) {
            errors.push(`${filePath}: only cdp-session.mjs may have a shebang or direct-execution guard.`);
        }
        const moduleAnalysis = isJavaScriptRuntime(filePath)
            ? moduleSpecifiers(inspectedSource)
            : { escapedSpecifiers: [], nonStaticDynamicImports: [], specifiers: [] };
        const imports = moduleAnalysis.specifiers;
        if (moduleAnalysis.escapedSpecifiers.length > 0) {
            errors.push(`${filePath}: module specifier escape sequences are forbidden; use the decoded literal path.`);
        }
        const unsupportedDynamicImport = moduleAnalysis.nonStaticDynamicImports.find(
            (argument) => !isApprovedComputedDynamicImport(filePath, argument),
        );
        if (unsupportedDynamicImport) {
            errors.push(`${filePath}: dynamic import must use a static string or template literal module specifier.`);
        }
        if (filePath.includes('/domains/')) {
            const forbidden = imports.find(
                (specifier) =>
                    isForbiddenDomainDependency(specifier) ||
                    ['adapters', 'application', 'interface'].includes(resolveRuntimeLayer(filePath, specifier)),
            );
            if (forbidden) {
                errors.push(`${filePath}: domain must not import I/O dependency ${forbidden}.`);
            }
        }
        if (filePath.includes('/adapters/')) {
            const forbidden = imports.find((specifier) =>
                ['application', 'interface'].includes(resolveRuntimeLayer(filePath, specifier)),
            );
            if (forbidden) {
                errors.push(`${filePath}: adapter must not import application or interface code ${forbidden}.`);
            }
        }
        if (filePath.includes('/shared/')) {
            const forbidden = imports.find((specifier) =>
                ['adapters', 'application', 'domains', 'interface'].includes(resolveRuntimeLayer(filePath, specifier)),
            );
            if (forbidden) {
                errors.push(`${filePath}: shared code must not import higher layer ${forbidden}.`);
            }
        }
        if (filePath.includes('/interface/')) {
            const forbidden = imports.find((specifier) =>
                ['adapters', 'domains'].includes(resolveRuntimeLayer(filePath, specifier)),
            );
            if (forbidden) {
                errors.push(`${filePath}: interface code must enter through application, not ${forbidden}.`);
            }
        }
        if (hasTerminationApi(inspectedSource)) {
            errors.push(`${filePath}: forbidden force-kill or process-termination command/API detected.`);
        }
        const externalAddress = externalNetworkLiteral(inspectedSource);
        if (externalAddress) {
            errors.push(`${filePath}: CDP binding must remain loopback-only; found ${externalAddress}.`);
        }
        if (/--(?:category-?pwa|no-category-?pwa)(?:=|\b)/i.test(inspectedSource)) {
            errors.push(`${filePath}: forbidden PWA category option detected.`);
        }
    }

    for (const [filePath, source] of Object.entries(files)) {
        const lines = source.split('\n');
        for (const [index, line] of lines.entries()) {
            const identifier = legacyIdentifiers().find((candidate) => line.includes(candidate));
            if (!identifier) continue;
            const explicitNegativeTestExemption = [lines[index - 1], line, lines[index + 1]].some((candidate) =>
                candidate?.includes('audit-allow-legacy: negative-test'),
            );
            if (filePath.startsWith('tests/') && explicitNegativeTestExemption) continue;
            errors.push(`${filePath}:${index + 1}: legacy public identifier ${identifier} must not ship.`);
        }
    }

    const constants = files[`${SKILL_ROOT}/scripts/shared/constants.mjs`] ?? '';
    const block = constants.match(/APPROVED_STATE_FIELDS\s*=\s*Object\.freeze\(\[([\s\S]*?)]\)/)?.[1] ?? '';
    const fields = [...block.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
    if (JSON.stringify(fields) !== JSON.stringify(APPROVED_STATE_FIELDS)) {
        const extras = fields.filter((field) => !APPROVED_STATE_FIELDS.includes(field));
        errors.push(
            `Approved state fields must match the privacy inventory exactly${
                extras.length > 0 ? `; forbidden fields: ${extras.join(', ')}` : ''
            }.`,
        );
    }
}

function auditSkill(files, skillMetadata, openaiMetadata, errors) {
    const skillPath = `${SKILL_ROOT}/SKILL.md`;
    const skill = files[skillPath] ?? '';
    auditMappingKeys(skillMetadata, ['name', 'description', 'license', 'metadata'], 'Skill frontmatter', errors);
    auditMappingKeys(skillMetadata?.metadata, ['version'], 'Skill metadata', errors);
    if (skillMetadata?.name !== 'debugging-cdp-targets') {
        errors.push('Skill name must match its debugging-cdp-targets folder.');
    }
    if (typeof skillMetadata?.description !== 'string' || skillMetadata.description.trim().length === 0) {
        errors.push('Skill description must be a non-empty string.');
    }
    if (skillMetadata?.license !== 'MIT') {
        errors.push('Skill license metadata must be MIT.');
    }
    if (!isMapping(skillMetadata?.metadata) || skillMetadata.metadata.version !== EXPECTED_VERSION) {
        errors.push(`Skill metadata version must be ${EXPECTED_VERSION}.`);
    }
    if (!/Compatibility:.*Windows 10 or later.*Node\.js 24\.21\.0.*npx/i.test(skill)) {
        errors.push('Skill compatibility must name Windows 10 or later, Node.js 24.21.0, and npx.');
    }

    auditMappingKeys(openaiMetadata, ['interface', 'policy'], 'OpenAI metadata', errors);
    auditMappingKeys(
        openaiMetadata?.interface,
        ['display_name', 'short_description', 'default_prompt'],
        'OpenAI interface metadata',
        errors,
    );
    auditMappingKeys(openaiMetadata?.policy, ['allow_implicit_invocation'], 'OpenAI policy metadata', errors);
    if (!isMapping(openaiMetadata?.interface)) {
        errors.push('OpenAI metadata must contain an interface mapping.');
    }
    if (openaiMetadata?.interface?.display_name !== 'Debugging CDP Targets') {
        errors.push('OpenAI metadata display_name must be Debugging CDP Targets.');
    }
    const shortDescription = openaiMetadata?.interface?.short_description;
    if (typeof shortDescription !== 'string' || shortDescription.length < 25 || shortDescription.length > 64) {
        errors.push('OpenAI metadata short_description must be a 25-64 character string.');
    }
    const defaultPrompt = openaiMetadata?.interface?.default_prompt;
    if (typeof defaultPrompt !== 'string') {
        errors.push('OpenAI default prompt must be a string that references $debugging-cdp-targets.');
    } else if (!defaultPrompt.includes('$debugging-cdp-targets')) {
        errors.push('OpenAI default prompt must reference $debugging-cdp-targets.');
    }
    if (!isMapping(openaiMetadata?.policy)) {
        errors.push('OpenAI metadata must contain a policy mapping.');
    }
    if (typeof openaiMetadata?.policy?.allow_implicit_invocation !== 'boolean') {
        errors.push('OpenAI allow_implicit_invocation must be a boolean.');
    } else if (openaiMetadata.policy.allow_implicit_invocation !== true) {
        errors.push('OpenAI metadata must allow implicit invocation.');
    }

    for (const [filePath, source] of Object.entries(files)) {
        if (!filePath.startsWith(`${SKILL_ROOT}/`) || !filePath.endsWith('.md')) {
            continue;
        }
        const targets = [...source.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)].map((match) => match[1]);
        for (const match of source.matchAll(/^[ ]{0,3}\[[^\]\r\n]+]:[ \t]*(?:\n[ \t]*)?(?:<([^>\r\n]+)>|(\S+))/gm)) {
            targets.push(match[1] ?? match[2]);
        }
        for (const rawTarget of targets) {
            const target = rawTarget.trim().split('#', 1)[0];
            if (!target || target.startsWith('#') || /^[a-z]+:/i.test(target)) {
                continue;
            }
            if (target.startsWith('/')) {
                errors.push(`${filePath}: relative reference ${target} must remain inside the Skill payload.`);
                continue;
            }
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), target));
            if (resolved !== SKILL_ROOT && !resolved.startsWith(`${SKILL_ROOT}/`)) {
                errors.push(`${filePath}: relative reference ${target} must remain inside the Skill payload.`);
                continue;
            }
            if (!(resolved in files)) {
                errors.push(`${filePath}: relative reference ${target} is missing.`);
            }
        }
    }
}

function auditInventory(files, physicalPayloadFiles, invalidPayloadEntries, errors) {
    const skillManifests = Object.keys(files).filter((filePath) => filePath.endsWith('/SKILL.md'));
    if (skillManifests.length !== 1 || skillManifests[0] !== `${SKILL_ROOT}/SKILL.md`) {
        errors.push(
            `Repository must discover exactly one Skill at ${SKILL_ROOT}/SKILL.md}; found ${skillManifests.join(', ') || 'none'}.`,
        );
    }
    for (const invalid of invalidPayloadEntries) {
        errors.push(`${invalid}: production payload must contain ordinary files and directories only.`);
    }
    const auditedPayloadFiles = new Set(Object.keys(files).filter((filePath) => filePath.startsWith(`${SKILL_ROOT}/`)));
    for (const filePath of physicalPayloadFiles) {
        if (!auditedPayloadFiles.has(filePath)) {
            errors.push(
                `Production payload: ${filePath.slice(SKILL_ROOT.length + 1)} must be tracked or non-ignored so its contents are audited.`,
            );
        }
    }
    const relativeFiles = physicalPayloadFiles.map((filePath) => filePath.slice(SKILL_ROOT.length + 1));
    for (const error of validatePayloadFileInventory(relativeFiles)) {
        errors.push(`Production payload: ${error}`);
    }
}

export function auditRepositorySnapshot(snapshot) {
    const files = Object.fromEntries(
        Object.entries(snapshot.files).map(([filePath, contents]) => [normalize(filePath), contents]),
    );
    const normalizedSnapshot = {
        ...snapshot,
        files,
        invalidPayloadEntries: (snapshot.invalidPayloadEntries ?? []).map(normalize),
        physicalPayloadFiles: (
            snapshot.physicalPayloadFiles ??
            Object.keys(files).filter((filePath) => filePath.startsWith(`${SKILL_ROOT}/`))
        ).map(normalize),
        trackedFiles: snapshot.trackedFiles.map(normalize),
    };
    const errors = [];
    const skillMetadata = parseSkillFrontmatter(files[`${SKILL_ROOT}/SKILL.md`] ?? '', errors);
    const openaiMetadata = parseYamlMapping(
        files[`${SKILL_ROOT}/agents/openai.yaml`] ?? '',
        'OpenAI metadata YAML',
        errors,
    );
    auditDirectories(normalizedSnapshot, errors);
    auditSymlink(normalizedSnapshot, errors);
    auditVersions(files, skillMetadata, errors);
    auditLicenses(files, errors);
    for (const [filePath, source] of Object.entries(files)) {
        if (filePath === 'CLAUDE.md') {
            continue;
        }
        errors.push(...validateTextStyle(filePath, source));
    }
    auditRuntime(files, errors);
    auditSkill(files, skillMetadata, openaiMetadata, errors);
    auditInventory(files, normalizedSnapshot.physicalPayloadFiles, normalizedSnapshot.invalidPayloadEntries, errors);
    return errors;
}

function readPhysicalPayload(root) {
    const payloadRoot = path.join(root, ...SKILL_ROOT.split('/'));
    const files = [];
    const invalidEntries = [];
    if (!existsSync(payloadRoot)) return { files, invalidEntries };

    function visit(directory, relative = '') {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(absolutePath, relativePath);
            } else if (entry.isFile()) {
                files.push(`${SKILL_ROOT}/${relativePath}`);
            } else {
                invalidEntries.push(`${SKILL_ROOT}/${relativePath}`);
            }
        }
    }
    visit(payloadRoot);
    return { files, invalidEntries };
}

export function createRepositorySnapshot(root) {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    });
    const trackedFiles = output.split('\0').filter(Boolean).map(normalize);
    const stageOutput = execFileSync('git', ['ls-files', '--stage', '-z'], {
        cwd: root,
        encoding: 'utf8',
    });
    const trackedModes = {};
    for (const entry of stageOutput.split('\0').filter(Boolean)) {
        const match = entry.match(/^(\d+) [0-9a-f]+ \d+\t(.+)$/);
        if (match) {
            trackedModes[normalize(match[2])] = match[1];
        }
    }
    const files = {};
    const symlinks = {};
    for (const filePath of trackedFiles) {
        const absolute = path.join(root, ...filePath.split('/'));
        if (trackedModes[filePath] === '120000') {
            symlinks[filePath] = normalize(readlinkSync(absolute));
            files[filePath] = symlinks[filePath];
        } else {
            files[filePath] = readFileSync(absolute, 'utf8');
        }
    }
    const physicalPayload = readPhysicalPayload(root);
    return {
        files,
        symlinks,
        trackedFiles,
        trackedModes,
        physicalPayloadFiles: physicalPayload.files,
        invalidPayloadEntries: physicalPayload.invalidEntries,
    };
}

function run() {
    const root = process.cwd();
    const errors = auditRepositorySnapshot(createRepositorySnapshot(root));
    if (errors.length > 0) {
        console.error(errors.map((error) => `- ${error}`).join('\n'));
        process.exitCode = 1;
        return;
    }
    console.log('Repository audit passed.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
    run();
}
