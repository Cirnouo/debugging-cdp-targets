import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadOfficialToolCatalog } from '../src/adapters/tool-catalog.ts';

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
    assert.ok(config.missingConditions.includes('--experimentalVision=true'));
    assert.ok(config.missingConditions.includes('--slim=false'));
    assert.ok(config.suggestedMcpArgs?.includes('--workspace=C:/output'));
    assert.equal(catalog.requirements('install_pwa', []).supported, false);
    assert.equal(catalog.requirements('evaluate', ['--slim']).missingConditions.length, 0);
    assert.throws(() => catalog.requirements('unknown', []), /Unknown/);
    assert.throws(
        () =>
            catalog.validate([
                { name: 'click_at', inputSchema: { type: 'object', properties: { invented: { type: 'boolean' } } } },
            ]),
        /catalog/,
    );
});
