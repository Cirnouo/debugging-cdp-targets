import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SKILL_NAME, validatePayloadFileInventory } from './payload-policy.mjs';

const repositoryOnlyNames = new Set([
    '.github',
    '.husky',
    'biome.json',
    'commitlint.config.mjs',
    'mise.toml',
    'node_modules',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tests',
    'tooling',
]);

export function parseDiscoveredSkills(output) {
    const plain = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b\[\?\d+[hl]/g, '');
    const lines = plain.split(/\r?\n/);
    const reportedCountMatch = plain.match(/\bFound\s+(\d+)\s+skills?\b/i);
    const start = lines.findIndex((line) => /Available Skills/i.test(line));
    const candidates = [];
    for (const line of start < 0 ? [] : lines.slice(start + 1)) {
        if (/Use\s+--skill\b/i.test(line)) break;
        const withoutMarker = line.replace(/^\s*(?:[|│┃])/, '');
        const indentation = withoutMarker.match(/^ */)?.[0].length ?? 0;
        const candidate = withoutMarker.trim();
        if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) {
            candidates.push({ indentation, name: candidate });
        }
    }
    const skillIndentation =
        candidates.length > 0 ? Math.min(...candidates.map((candidate) => candidate.indentation)) : 0;
    const names = candidates
        .filter((candidate) => candidate.indentation === skillIndentation)
        .map((candidate) => candidate.name);
    return {
        reportedCount: reportedCountMatch ? Number.parseInt(reportedCountMatch[1], 10) : null,
        names,
    };
}

export function validateDiscoveredSkills(discovery, expectedName = SKILL_NAME) {
    const errors = [];
    if (!Number.isInteger(discovery.reportedCount)) {
        errors.push('Skills CLI discovery did not report a numeric Skill count.');
    } else if (discovery.reportedCount !== discovery.names.length) {
        errors.push(
            `Skills CLI count mismatch: reported ${discovery.reportedCount}, emitted ${discovery.names.length}.`,
        );
    }
    if (new Set(discovery.names).size !== discovery.names.length) {
        errors.push('Skills CLI discovery emitted a duplicate Skill name.');
    }
    if (discovery.names.length !== 1 || discovery.names[0] !== expectedName) {
        errors.push(
            `Skills CLI discovery must return exactly ${expectedName}; found ${discovery.names.join(', ') || 'none'}.`,
        );
    }
    return errors;
}

export function compareDistributionTrees(source, installed) {
    const errors = [];
    for (const [filePath, contents] of source) {
        if (!installed.has(filePath)) {
            errors.push(`${filePath}: missing from temporary Skills CLI installation.`);
        } else if (!contents.equals(installed.get(filePath))) {
            errors.push(`${filePath}: installed file is not byte-for-byte identical to source.`);
        }
    }
    for (const filePath of installed.keys()) {
        if (!source.has(filePath)) {
            errors.push(`${filePath}: extra file in temporary Skills CLI installation.`);
        }
        const segments = filePath.split('/');
        const repositoryOnly = segments.find((segment) => repositoryOnlyNames.has(segment));
        if (repositoryOnly) {
            errors.push(`${filePath}: repository-only ${repositoryOnly} must not be installed.`);
        }
    }
    return errors;
}

async function readTree(root, relative = '', result = new Map()) {
    const directory = path.join(root, ...relative.split('/').filter(Boolean));
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const filePath = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            await readTree(root, filePath, result);
        } else if (entry.isFile()) {
            result.set(filePath, await readFile(path.join(root, ...filePath.split('/'))));
        } else {
            throw new Error(`${filePath}: distribution payload must contain only files and directories.`);
        }
    }
    return result;
}

function runSkills(cliPath, arguments_, cwd) {
    const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            CI: '1',
            FORCE_COLOR: '0',
            NO_COLOR: '1',
        },
        windowsHide: true,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`Skills CLI failed (${result.status}):\n${result.stdout ?? ''}${result.stderr ?? ''}`);
    }
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

export async function auditDistribution(root) {
    const cliPath = path.join(root, 'node_modules', 'skills', 'bin', 'cli.mjs');
    const discoveryOutput = runSkills(cliPath, ['add', root, '--list'], root);
    const discovered = parseDiscoveredSkills(discoveryOutput);
    const discoveryErrors = validateDiscoveredSkills(discovered);
    if (discoveryErrors.length > 0) return discoveryErrors;

    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `${SKILL_NAME}-install-`));
    try {
        runSkills(
            cliPath,
            ['add', root, '--skill', SKILL_NAME, '--agent', 'codex', '--copy', '--yes', '--json'],
            temporaryRoot,
        );
        const sourceRoot = path.join(root, 'skills', SKILL_NAME);
        const installedRoot = path.join(temporaryRoot, '.agents', 'skills', SKILL_NAME);
        const source = await readTree(sourceRoot);
        const inventoryErrors = validatePayloadFileInventory(source.keys());
        if (inventoryErrors.length > 0) return inventoryErrors;
        return compareDistributionTrees(source, await readTree(installedRoot));
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

async function run() {
    try {
        const errors = await auditDistribution(process.cwd());
        if (errors.length > 0) {
            console.error(errors.map((error) => `- ${error}`).join('\n'));
            process.exitCode = 1;
            return;
        }
        console.log('Distribution audit passed: one discovered Skill and byte-identical copy install.');
    } catch (error) {
        console.error(`Distribution audit failed: ${error.message}`);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
    await run();
}
