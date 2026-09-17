import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = 'skills/debugging-cdp-targets';
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

function scalarFromYaml(source, key) {
    const match = source.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'));
    return match?.[1]?.trim();
}

function skillFrontmatter(source) {
    const match = source.match(/^---\n(?<frontmatter>[\s\S]*?)\n---(?:\n|$)/);
    return match?.groups?.frontmatter ?? '';
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

function auditVersions(files, errors) {
    let packageData;
    try {
        packageData = JSON.parse(files['package.json'] ?? '');
    } catch (error) {
        errors.push(`package.json must be valid JSON: ${error.message}`);
        return;
    }
    const skillSource = files[`${SKILL_ROOT}/SKILL.md`] ?? '';
    const frontmatter = skillFrontmatter(skillSource);
    const changelog = files['CHANGELOG.md'] ?? '';
    const mise = files['mise.toml'] ?? '';
    const actual = {
        'package version': packageData.version,
        'Skill version': scalarFromYaml(frontmatter, 'version'),
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
    if (files.LICENSE !== files[`${SKILL_ROOT}/LICENSE`]) {
        errors.push('Root and production payload MIT licenses must be byte-identical.');
    }
}

function auditRuntime(files, errors) {
    const runtimeEntries = Object.entries(files).filter(([filePath]) => filePath.startsWith(`${SKILL_ROOT}/scripts/`));
    for (const [filePath, source] of runtimeEntries) {
        const isEntry = filePath === `${SKILL_ROOT}/scripts/cdp-session.mjs`;
        const hasExecutableMarker = source.startsWith('#!') || source.includes('import.meta.url ===');
        if (hasExecutableMarker && !isEntry) {
            errors.push(`${filePath}: only cdp-session.mjs may have a shebang or direct-execution guard.`);
        }
        if (filePath.includes('/domains/')) {
            const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
            const forbidden = imports.find((specifier) =>
                /(^node:(?:child_process|fs|http|https|net|os|process)$)|(?:powershell)|(?:\/application\/)|(?:\/adapters\/)/i.test(
                    specifier,
                ),
            );
            if (forbidden) {
                errors.push(`${filePath}: domain must not import I/O dependency ${forbidden}.`);
            }
        }
        if (filePath.includes('/adapters/') && /["'][^"']*\/application\//.test(source)) {
            errors.push(`${filePath}: adapter must not import application code.`);
        }
        const unsafeProcessKill = [...source.matchAll(/process\.kill\(([^)]*)\)/g)].some((match) => {
            const arguments_ = match[1].split(',').map((argument) => argument.trim());
            return arguments_.length < 2 || arguments_[1] !== '0';
        });
        if (/taskkill(?:\.exe)?[^\n]*\/F|Stop-Process[^\n]*-Force/i.test(source) || unsafeProcessKill) {
            errors.push(`${filePath}: forbidden force-kill command or API detected.`);
        }
        if (/0\.0\.0\.0|\[::\]|["']::["']/.test(source)) {
            errors.push(`${filePath}: CDP binding must remain loopback-only.`);
        }
        if (/--(?:category-?pwa|no-category-?pwa)(?:=|\b)/i.test(source)) {
            errors.push(`${filePath}: forbidden PWA category option detected.`);
        }
    }

    const publicFiles = Object.entries(files).filter(
        ([filePath]) => filePath.startsWith(`${SKILL_ROOT}/`) && !filePath.endsWith('/AGENTS.md'),
    );
    for (const [filePath, source] of publicFiles) {
        const oldIdentifier = ['--target-kind', 'targetKind'].find((identifier) => source.includes(identifier));
        if (oldIdentifier) {
            errors.push(`${filePath}: old public identifier ${oldIdentifier} must not ship.`);
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

function auditSkill(files, errors) {
    const skillPath = `${SKILL_ROOT}/SKILL.md`;
    const skill = files[skillPath] ?? '';
    const frontmatter = skillFrontmatter(skill);
    if (scalarFromYaml(frontmatter, 'name') !== 'debugging-cdp-targets') {
        errors.push('Skill name must match its debugging-cdp-targets folder.');
    }
    if (scalarFromYaml(frontmatter, 'license') !== 'MIT') {
        errors.push('Skill license metadata must be MIT.');
    }
    if (scalarFromYaml(frontmatter, 'version') !== EXPECTED_VERSION) {
        errors.push(`Skill metadata version must be ${EXPECTED_VERSION}.`);
    }
    if (!/Compatibility:.*Windows 10 or later.*Node\.js 24\.21\.0.*npx/i.test(skill)) {
        errors.push('Skill compatibility must name Windows 10 or later, Node.js 24.21.0, and npx.');
    }

    const openai = files[`${SKILL_ROOT}/agents/openai.yaml`] ?? '';
    if (scalarFromYaml(openai, 'display_name') !== 'Debugging CDP Targets') {
        errors.push('OpenAI metadata display_name must be Debugging CDP Targets.');
    }
    if (!scalarFromYaml(openai, 'short_description')) {
        errors.push('OpenAI metadata must provide short_description.');
    }
    if (!scalarFromYaml(openai, 'default_prompt')?.includes('$debugging-cdp-targets')) {
        errors.push('OpenAI default prompt must reference $debugging-cdp-targets.');
    }
    if (scalarFromYaml(openai, 'allow_implicit_invocation') !== 'true') {
        errors.push('OpenAI metadata must allow implicit invocation.');
    }

    for (const [filePath, source] of Object.entries(files)) {
        if (!filePath.startsWith(`${SKILL_ROOT}/`) || !filePath.endsWith('.md')) {
            continue;
        }
        for (const match of source.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
            const target = match[1].split('#', 1)[0];
            if (!target || /^(?:[a-z]+:|\/)/i.test(target)) {
                continue;
            }
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), target));
            if (!(resolved in files)) {
                errors.push(`${filePath}: relative reference ${target} is missing.`);
            }
        }
    }
}

function auditInventory(files, errors) {
    const skillManifests = Object.keys(files).filter((filePath) => filePath.endsWith('/SKILL.md'));
    if (skillManifests.length !== 1 || skillManifests[0] !== `${SKILL_ROOT}/SKILL.md`) {
        errors.push(
            `Repository must discover exactly one Skill at ${SKILL_ROOT}/SKILL.md}; found ${skillManifests.join(', ') || 'none'}.`,
        );
    }
    const allowedTopLevelFiles = new Set(['AGENTS.md', 'LICENSE', 'README.md', 'SKILL.md']);
    for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(`${SKILL_ROOT}/`)) {
            continue;
        }
        const relative = filePath.slice(SKILL_ROOT.length + 1);
        const [first] = relative.split('/');
        if (!allowedTopLevelFiles.has(relative) && !['agents', 'references', 'scripts'].includes(first)) {
            errors.push(`${filePath}: production payload contains repository-only file ${relative}.`);
        }
    }
}

export function auditRepositorySnapshot(snapshot) {
    const files = Object.fromEntries(
        Object.entries(snapshot.files).map(([filePath, contents]) => [normalize(filePath), contents]),
    );
    const normalizedSnapshot = {
        ...snapshot,
        files,
        trackedFiles: snapshot.trackedFiles.map(normalize),
    };
    const errors = [];
    auditDirectories(normalizedSnapshot, errors);
    auditSymlink(normalizedSnapshot, errors);
    auditVersions(files, errors);
    auditLicenses(files, errors);
    for (const [filePath, source] of Object.entries(files)) {
        if (filePath === 'CLAUDE.md') {
            continue;
        }
        errors.push(...validateTextStyle(filePath, source));
    }
    auditRuntime(files, errors);
    auditSkill(files, errors);
    auditInventory(files, errors);
    return errors;
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
    return { files, symlinks, trackedFiles, trackedModes };
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
