import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToolCatalog, loadOfficialToolCatalog } from '../src/adapters/tool-catalog.ts';

test('fixed catalog exposes configuration conditions and compatible official schema variants', async () => {
    const catalog = await loadOfficialToolCatalog();
    const names = catalog.tools.map((tool) => tool.name);
    assert.equal(names.length, 67);
    assert.ok(names.includes('evaluate') && names.includes('evaluate_script') && names.includes('click_at'));
    const click = catalog.tools.find((tool) => tool.name === 'click_at');
    assert.match(click?.description ?? '', /experimentalVision=true/);
    const evaluate = catalog.tools.find((tool) => tool.name === 'evaluate_script');
    assert.ok(evaluate?.inputSchema.properties?.pageId);
    assert.ok(!evaluate?.inputSchema.required?.includes('pageId'));
    assert.ok(evaluate?.inputSchema.properties?.function);
    assert.ok(evaluate?.inputSchema.properties?.sourcePath);
    assert.ok(!evaluate?.inputSchema.required?.includes('function'));
    assert.ok(names.includes('analyze_heapsnapshot_contexts'));
    const memory = catalog.requirements('analyze_heapsnapshot_contexts', []);
    assert.ok(memory.missingConditions?.includes('--memoryDebugging=true'));
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
        version: '1.11.0',
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

test('catalog validates complete reviewed definitions canonically and rejects ambiguous routing', () => {
    const reviewed = {
        name: 'echo',
        description: 'Reviewed echo',
        inputSchema: { type: 'object' as const, properties: { value: { type: 'number' } }, required: ['value'] },
        outputSchema: { type: 'object' as const, properties: { value: { type: 'number' } }, required: ['value'] },
        annotations: { readOnlyHint: true },
        _meta: { reviewed: true },
    };
    const catalog = createToolCatalog({
        version: '1.11.0',
        tools: [{ name: 'echo', requires: {}, variants: [reviewed] }],
    });
    assert.doesNotThrow(() =>
        catalog.validate([
            {
                _meta: { reviewed: true },
                annotations: { readOnlyHint: true },
                outputSchema: { required: ['value'], properties: { value: { type: 'number' } }, type: 'object' },
                inputSchema: { required: ['value'], properties: { value: { type: 'number' } }, type: 'object' },
                description: 'Reviewed echo',
                name: 'echo',
            },
        ]),
    );
    for (const changed of [
        { ...reviewed, outputSchema: { type: 'object' as const } },
        { ...reviewed, description: 'Unreviewed instructions' },
        { ...reviewed, annotations: { readOnlyHint: false } },
        { ...reviewed, _meta: { reviewed: false } },
        { ...reviewed, name: 'unknown' },
    ])
        assert.throws(() => catalog.validate([changed]), /reviewed|catalog/);
    assert.throws(() => catalog.validate([reviewed, reviewed]), /duplicate|catalog/i);
    for (const collision of [
        { name: 'dct_registration_register', inputSchema: { type: 'object' as const } },
        { name: 'echo', inputSchema: { type: 'object' as const, properties: { _dct: {} } } },
    ]) {
        const ambiguous = createToolCatalog({
            version: '1.11.0',
            tools: [{ name: collision.name, requires: {}, variants: [collision] }],
        });
        assert.throws(() => ambiguous.validate([collision]), /reserved.*routing/i);
    }
});
