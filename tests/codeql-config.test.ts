import assert from 'node:assert/strict';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';

const workflowUrl = new URL('../.github/workflows/codeql.yaml', import.meta.url);
async function workflow() {
    assert.ok(existsSync(workflowUrl), 'A maintained CodeQL workflow is required.');
    const parsed: unknown = parse(await readFile(workflowUrl, 'utf8'));
    assert.ok(isRecord(parsed) && isRecord(parsed.on) && isRecord(parsed.jobs));
    const job = parsed.jobs.analyze;
    assert.ok(isRecord(job) && Array.isArray(job.steps));
    const steps = job.steps.map((step: unknown) => {
        assert.ok(isRecord(step));
        return step;
    });
    return { parsed, on: parsed.on, job, steps };
}

test('CodeQL scans PRs with scoped upload permissions and no application execution', async () => {
    const { parsed, on, job, steps } = await workflow();
    assert.equal(on.pull_request_target, undefined);
    assert.deepEqual(on.push, { branches: ['main'] });
    assert.deepEqual(on.pull_request, { branches: ['main'] });
    assert.deepEqual(on.schedule, [{ cron: '47 1 * * 1' }]);
    assert.deepEqual(parsed.permissions, { contents: 'read' });
    assert.deepEqual(job.permissions, { contents: 'read', 'security-events': 'write' });
    assert.equal(job['continue-on-error'], undefined);
    const allowed = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
        'github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
    ]);
    for (const step of steps) {
        assert.equal(step['continue-on-error'], undefined);
        if (step.uses) assert.ok(allowed.has(String(step.uses)), 'Unreviewed action reference.');
        if (step.run) assert.doesNotMatch(String(step.run), /pnpm|npm|npx|mcp-bootstrap|smoke|build:plugin/);
    }
    const checkout = steps.find((step) => String(step.uses).startsWith('actions/checkout@'));
    assert.deepEqual(checkout?.with, { 'persist-credentials': false });
});

test('CodeQL covers owned languages without executing a C# build', async () => {
    const { job, steps } = await workflow();
    assert.ok(isRecord(job.strategy) && isRecord(job.strategy.matrix));
    assert.deepEqual(job.strategy.matrix.include, [
        { language: 'javascript-typescript', os: 'ubuntu-24.04', 'build-mode': 'none' },
        { language: 'csharp', os: 'windows-latest', 'build-mode': 'none' },
        { language: 'actions', os: 'ubuntu-24.04', 'build-mode': 'none' },
    ]);
    const init = steps.find((step) => String(step.uses).includes('/init@'));
    assert.ok(isRecord(init?.with));
    assert.equal(init.with['build-mode'], `\${{ matrix.build-mode }}`);
    const config: unknown = parse(await readFile(new URL('../.github/codeql-config.yaml', import.meta.url), 'utf8'));
    assert.ok(isRecord(config));
    assert.deepEqual(config.paths, ['src', 'tooling', '.github']);
    assert.deepEqual(config.queries, [{ uses: 'security-extended' }]);
    assert.ok(Array.isArray(config['paths-ignore']));
    for (const generated of ['plugins/**', 'tooling/security/dist/**', '**/node_modules/**'])
        assert.ok(config['paths-ignore'].includes(generated));
});

test('CodeQL extracts the exact fixed query/create source sets while query has no mutating implementation', async () => {
    const { steps } = await workflow();
    const evidence = steps.find((step) => step.id === 'native-extraction');
    assert.ok(evidence && typeof evidence.run === 'string');
    assert.match(
        evidence.run,
        /@\('src\/adapters\/windows-native-process\.cs', 'src\/adapters\/windows-deployment-authority\.cs', 'src\/adapters\/windows-deployment-create\.cs'\)/,
    );
    assert.match(evidence.run, /\$nativeSource\.Count -ne 1/);
    const query = await readFile(new URL('../src/adapters/windows-deployment-authority.cs', import.meta.url), 'utf8');
    const create = await readFile(new URL('../src/adapters/windows-deployment-create.cs', import.meta.url), 'utf8');
    assert.match(query, /class DctDeploymentQueryProgram/);
    assert.match(query, /arguments\.Length != 0/);
    assert.match(query, /DctDeploymentAuthority\.Inspect\(name\)/);
    assert.doesNotMatch(query, /DctDeploymentCreate|CreateDirectoryW|SetFileInformationByHandle|CREATE_NEW/);
    assert.match(create, /class DctDeploymentCreateProgram/);
    assert.match(create, /DctDeploymentWire\.Mutation\(Console\.OpenStandardInput\(\)\)/);
    assert.match(create, /DctDeploymentCreate\.Execute\(fields\[0\]/);
});

test('C# evidence step rejects archives without the native helper', {
    skip: process.platform !== 'win32',
}, async () => {
    const { steps } = await workflow();
    const evidence = steps.find((step) => step.id === 'native-extraction');
    assert.ok(evidence && typeof evidence.run === 'string');
    assert.equal(evidence.if, "matrix.language == 'csharp'");
    assert.equal(evidence.shell, 'pwsh');
    const folder = await mkdtemp(path.join(os.tmpdir(), 'dct-codeql-evidence-'));
    try {
        for (const [entries, expected] of [
            [
                [
                    'C/repository/src/adapters/windows-native-process.cs',
                    'C/repository/src/adapters/windows-deployment-authority.cs',
                    'C/repository/src/adapters/windows-deployment-create.cs',
                ],
                0,
            ],
            [['C/repository/src/adapters/windows-native-process.cs'], 1],
            [['C/repository/src/adapters/windows-deployment-authority.cs'], 1],
            [
                [
                    'C/repository/src/adapters/windows-native-process.cs',
                    'C/repository/src/adapters/windows-deployment-authority.cs',
                    'C/repository/src/adapters/windows-deployment-create.cs',
                    'C/duplicate/src/adapters/windows-deployment-create.cs',
                ],
                1,
            ],
            [
                [
                    'C/repository/src/adapters/windows-native-process.cs',
                    'C/repository/src/adapters/windows-deployment-authority.cs',
                ],
                1,
            ],
            [['C/repository/tests/fixtures/native-window.cs'], 1],
        ] as const) {
            const archiveFolder = path.join(folder, `source-${entries.length}-${entries[0]?.split('/').at(-1)}`);
            const setup = `
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                [IO.Directory]::CreateDirectory((Join-Path $env:DCT_CODEQL_DATABASE_ROOT 'csharp')) | Out-Null
                $fixtureArchive = [IO.Compression.ZipFile]::Open((Join-Path $env:DCT_CODEQL_DATABASE_ROOT 'csharp/src.zip'), 'Create')
                foreach ($entry in ($env:DCT_TEST_SOURCE_ENTRIES | ConvertFrom-Json)) { $fixtureArchive.CreateEntry($entry) | Out-Null }
                $fixtureArchive.Dispose()
            `;
            const result: SpawnSyncReturns<string> = spawnSync(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', setup + evidence.run],
                {
                    encoding: 'utf8',
                    windowsHide: true,
                    env: {
                        ...process.env,
                        DCT_CODEQL_DATABASE_ROOT: archiveFolder,
                        DCT_TEST_SOURCE_ENTRIES: JSON.stringify(entries),
                    },
                },
            );
            assert.equal(result.status, expected, result.stdout + result.stderr);
            if (expected === 0) assert.match(result.stdout, /native helper source extraction/i);
        }
    } finally {
        assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(folder).startsWith('dct-codeql-evidence-'));
        await rm(folder, { recursive: true, force: true });
    }
});
