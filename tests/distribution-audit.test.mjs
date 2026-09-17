import assert from 'node:assert/strict';
import test from 'node:test';

import { compareDistributionTrees, parseDiscoveredSkills } from '../tooling/distribution-audit.mjs';

test('parses exactly the Skill names emitted by Skills CLI discovery', () => {
    const output = [
        'Found 1 skill',
        'Available Skills',
        'debugging-cdp-targets',
        'Use when inspecting a CDP renderer.',
    ].join('\n');
    assert.deepEqual(parseDiscoveredSkills(output), ['debugging-cdp-targets']);
});

test('rejects Skills CLI discovery with missing or additional Skills', () => {
    assert.notDeepEqual(parseDiscoveredSkills('Found 0 skills\n'), ['debugging-cdp-targets']);
    assert.deepEqual(parseDiscoveredSkills('Found 2 skills\ndebugging-cdp-targets\nother-skill\n'), [
        'debugging-cdp-targets',
        'other-skill',
    ]);
});

test('accepts a byte-identical copied Skill payload', () => {
    const source = new Map([
        ['SKILL.md', Buffer.from('skill\n')],
        ['scripts/cdp-session.mjs', Buffer.from('entry\n')],
    ]);
    const installed = new Map([
        ['SKILL.md', Buffer.from('skill\n')],
        ['scripts/cdp-session.mjs', Buffer.from('entry\n')],
    ]);
    assert.deepEqual(compareDistributionTrees(source, installed), []);
});

test('reports missing, changed, extra, and repository-only installed files', () => {
    const source = new Map([
        ['SKILL.md', Buffer.from('skill\n')],
        ['scripts/cdp-session.mjs', Buffer.from('entry\n')],
        ['references/obsidian.md', Buffer.from('reference\n')],
    ]);
    const installed = new Map([
        ['SKILL.md', Buffer.from('changed\n')],
        ['scripts/cdp-session.mjs', Buffer.from('entry\n')],
        ['package.json', Buffer.from('{}\n')],
    ]);
    const message = compareDistributionTrees(source, installed).join('\n');
    assert.match(message, /SKILL\.md.*byte-for-byte/i);
    assert.match(message, /references\/obsidian\.md.*missing/i);
    assert.match(message, /package\.json.*extra/i);
    assert.match(message, /repository-only.*package\.json/i);
});
