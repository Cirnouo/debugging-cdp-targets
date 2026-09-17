import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compareDistributionTrees,
    parseDiscoveredSkills,
    validateDiscoveredSkills,
} from '../tooling/distribution-audit.mjs';

test('parses exactly the Skill names emitted by Skills CLI discovery', () => {
    const output = [
        'Found 1 skill',
        'Available Skills',
        'debugging-cdp-targets',
        'Use when inspecting a CDP renderer.',
    ].join('\n');
    assert.deepEqual(parseDiscoveredSkills(output), {
        reportedCount: 1,
        names: ['debugging-cdp-targets'],
    });
});

test('preserves legal single-word names and duplicate discovery records', () => {
    assert.deepEqual(
        parseDiscoveredSkills(
            'Found 3 skills\nAvailable Skills\n    solo\n      description\n    debugging-cdp-targets\n      description\n    solo\n',
        ),
        {
            reportedCount: 3,
            names: ['solo', 'debugging-cdp-targets', 'solo'],
        },
    );
});

test('rejects reported-count mismatches, duplicates, missing, and additional Skills', () => {
    assert.match(validateDiscoveredSkills({ reportedCount: 2, names: ['debugging-cdp-targets'] }).join('\n'), /count/i);
    assert.match(
        validateDiscoveredSkills({
            reportedCount: 2,
            names: ['debugging-cdp-targets', 'debugging-cdp-targets'],
        }).join('\n'),
        /duplicate/i,
    );
    assert.notDeepEqual(validateDiscoveredSkills({ reportedCount: 0, names: [] }), []);
    assert.notDeepEqual(
        validateDiscoveredSkills({
            reportedCount: 2,
            names: ['debugging-cdp-targets', 'other'],
        }),
        [],
    );
    assert.deepEqual(validateDiscoveredSkills({ reportedCount: 1, names: ['debugging-cdp-targets'] }), []);
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
