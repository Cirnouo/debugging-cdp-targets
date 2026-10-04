import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToolCatalog, loadOfficialToolCatalog } from '../src/adapters/tool-catalog.ts';

test('fixed catalog exposes configuration conditions and compatible official schema variants', async () => {
    const catalog = await loadOfficialToolCatalog();
    const names = catalog.tools.map((tool) => tool.name);
    assert.equal(names.length, 66);
    assert.ok(names.includes('evaluate') && names.includes('evaluate_script') && names.includes('click_at'));
    const click = catalog.tools.find((tool) => tool.name === 'click_at');
    assert.match(click?.description ?? '', /experimentalVision=true/);
    const evaluate = catalog.tools.find((tool) => tool.name === 'evaluate_script');
    assert.ok(evaluate?.inputSchema.properties?.pageId);
    assert.ok(!evaluate?.inputSchema.required?.includes('pageId'));
    assert.ok(evaluate?.inputSchema.required?.includes('function'));
    const config = catalog.requirements('click_at', ['--workspace=C:/output', '--slim']);
    assert.ok(config.missingConditions?.includes('--experimentalVision=true'));
    assert.ok(config.missingConditions?.includes('--slim=false'));
    assert.ok(config.suggestedMcpArgs?.includes('--workspace=C:/output'));
    assert.equal(catalog.requirements('install_pwa', []).supported, false);
    assert.equal(catalog.requirements('evaluate', ['--slim']).missingConditions?.length, 0);
    assert.throws(() => catalog.requirements('unknown', []), /Unknown/);
    assert.throws(
        () =>
            catalog.validate([
                { name: 'click_at', inputSchema: { type: 'object', properties: { invented: { type: 'boolean' } } } },
            ]),
        /catalog/,
    );
});

test('catalog recipes appear only for supported missing configuration and actual enabled tools keep exact schemas', () => {
    const exactSchema = {
        type: 'object' as const,
        properties: { function: { type: 'string' }, pageId: { type: 'number' } },
        required: ['function', 'pageId'],
    };
    const actual = { name: 'evaluate_script', inputSchema: exactSchema };
    const catalog = createToolCatalog({
        version: '1.10.1',
        tools: [
            { name: actual.name, requires: { slim: false }, variants: [actual] },
            {
                name: 'install_pwa',
                requires: { categoryPwa: true },
                variants: [{ name: 'install_pwa', inputSchema: { type: 'object' } }],
            },
        ],
    });
    assert.equal(catalog.requirements('evaluate_script', []).suggestedMcpArgs, undefined);
    assert.deepEqual(catalog.requirements('evaluate_script', ['--slim']).suggestedMcpArgs, ['--slim=false']);
    const enabled = catalog.describe(['--slim'], [actual], ['evaluate_script'])[0];
    assert.equal(enabled?.enabled, true);
    assert.equal(enabled?.suggestedMcpArgs, undefined);
    assert.deepEqual(enabled?.inputSchema, exactSchema);
    const missing = catalog.describe([], [], ['evaluate_script'])[0];
    assert.equal(missing?.enabled, false);
    assert.deepEqual(missing?.suggestedMcpArgs, ['--slim=false']);
    assert.deepEqual(catalog.requirements('evaluate_script', ['--workspace=C:/output'], true).suggestedMcpArgs, [
        '--workspace=C:/output',
        '--slim=false',
    ]);
    assert.deepEqual(catalog.describe([], [], ['evaluate_script'], true)[0]?.suggestedMcpArgs, ['--slim=false']);
    assert.equal(catalog.requirements('install_pwa', [], true).suggestedMcpArgs, undefined);
    assert.deepEqual(catalog.describe([], [], ['install_pwa'])[0], {
        name: 'install_pwa',
        supported: false,
        enabled: false,
        reason: 'Official PWA tools require a pipe-launched browser; the gateway manages a verified CDP endpoint.',
    });
    const requirementsOnly = catalog.describe([], undefined, ['evaluate_script'])[0];
    assert.equal(requirementsOnly?.enabled, undefined);
    assert.equal(requirementsOnly?.inputSchema, undefined);
    assert.equal(requirementsOnly?.suggestedMcpArgs, undefined);
    assert.equal(catalog.describe(['--slim'], undefined, ['evaluate_script'])[0]?.suggestedMcpArgs, undefined);
    assert.throws(() => catalog.describe([], [actual], ['unknown']), /Unknown official tool/);
});
