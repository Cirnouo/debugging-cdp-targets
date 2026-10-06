import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplicationScreenshotAdapter } from './application-screenshot-adapter.ts';
import { parseApplicationProbeConfig, runApplicationScreenshotProbe } from './application-screenshot-core.ts';
import { applicationScreenshotGatewayEnvironment } from './application-screenshot-fixture.ts';

assert.equal(process.platform, 'win32', 'This explicit application probe requires Windows.');
const [configPath, parent, arm, condition, mode] = process.argv.slice(2);
assert.ok(
    configPath && parent && path.isAbsolute(configPath) && path.isAbsolute(parent),
    'Supply absolute experiment JSON and evidence parent paths.',
);
assert.ok(arm === 'baseline' || arm === 'candidate', 'Choose baseline or candidate.');
assert.ok(
    condition === 'foreground-normal' || condition === 'background-normal' || condition === 'minimized',
    'Choose a declared native condition.',
);
assert.ok(
    mode === 'qualification' || mode === 'viewport' || mode === 'fullPage',
    'Choose qualification, viewport or fullPage.',
);
assert.equal(process.argv.length, 7, 'Unexpected application probe arguments.');
const environment = applicationScreenshotGatewayEnvironment(process.env);
const configBytes = await readFile(configPath);
const config = parseApplicationProbeConfig(JSON.parse(configBytes.toString('utf8')) as unknown, environment);
await mkdir(parent, { recursive: true });
const folder = await mkdtemp(path.join(parent, `${config.fixture.application}-${arm}-${mode}-`));
const events: unknown[] = [];
let writing = Promise.resolve();
const record = (kind: string, value: unknown) => {
    const event = { kind, utc: new Date().toISOString(), monotonicMs: performance.now(), value };
    const pending = writing.then(async () => {
        events.push(event);
        await writeFile(path.join(folder, 'evidence.json'), `${JSON.stringify({ config, events }, null, 4)}\n`);
        console.log(JSON.stringify({ kind, utc: event.utc, ...(kind === 'final' ? { result: value } : {}) }));
    });
    writing = pending.catch(() => {});
    return pending;
};
console.log(JSON.stringify({ kind: 'evidence-directory', folder }));
const helperNames = [
    'application-screenshot-probe.ts',
    'application-screenshot-core.ts',
    'application-screenshot-adapter.ts',
    'application-screenshot-native.ts',
    'application-screenshot-fixture.ts',
    'mcp-client.ts',
    'lifecycle-client.ts',
    'screenshot-capture-observer.ts',
    'screenshot-background-anchor.ts',
    'screenshot-fixture.ts',
    'window-evidence.ts',
    'windows-window-evidence.ps1',
    'windows-application-evidence.ps1',
    'windows-png-evidence.ps1',
    '../fixtures/compile-native-window.ps1',
    '../fixtures/native-window.cs',
    '../../src/adapters/windows-native-process.cs',
    '../../src/adapters/windows-native-helper.ps1',
    '../../src/adapters/platform-process.ts',
    '../../src/adapters/windows-launch.ts',
    '../../src/domains/cdp-target.ts',
    '../../src/domains/launch-command.ts',
    '../../src/domains/chromium-features.ts',
    '../../src/domains/control-contract.ts',
    '../../src/shared/errors.ts',
];
await record('runner-source-evidence', {
    node: {
        executable: process.execPath,
        version: process.version,
        sha256: createHash('sha256')
            .update(await readFile(process.execPath))
            .digest('hex'),
    },
    config: { path: configPath, sha256: createHash('sha256').update(configBytes).digest('hex') },
    helpers: await Promise.all(
        helperNames.map(async (name) => {
            const file = fileURLToPath(new URL(name, import.meta.url));
            return {
                file,
                sha256: createHash('sha256')
                    .update(await readFile(file))
                    .digest('hex'),
            };
        }),
    ),
});
await record('observation-limits', {
    interval: 'Local MCP dispatch/settlement callbacks do not expose CDP method timing.',
    visibility: 'Native placement and related anchor containment do not prove compositor occlusion.',
    feature: 'Actual argv establishes the selected bare feature carrier; internal FeatureList is unobserved.',
    timeouts: { gatewayDefaultMs: 60_000, clientReceiptMs: 90_000 },
});
const adapter = createApplicationScreenshotAdapter(config, folder, record);
const result = await runApplicationScreenshotProbe(
    config,
    {
        arm,
        condition,
        mode,
        parentDirectory: folder,
        filePath: path.join(folder, 'screenshot.png'),
        nonce: randomUUID(),
    },
    adapter,
);
await writing;
console.log(JSON.stringify({ kind: 'probe-complete', folder, result }));
process.exitCode = (result.outcome === 'success' || result.outcome === 'qualified') && result.cleanup?.ok ? 0 : 1;
// Uncertain cleanup retains the client child and its open stdio. Do not force exit:
// the evidence directory and identity ledger remain available for normal cleanup.
