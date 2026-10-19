import assert from 'node:assert/strict';
import test from 'node:test';
import { scanSubmissionMarkdown } from '../../../tooling/submissions/markdown.ts';

test('scans unindented lazy continuations of logically wrapped checklist labels', () => {
    assert.equal(
        scanSubmissionMarkdown('- [x] Focused tests and\n`pnpm verify:push` pass.\n')[0]?.checklists[0]?.label,
        'Focused tests and `pnpm verify:push` pass.',
    );
});

test('logical checkbox continuations stop at headings, lists, quotes and code fences', () => {
    for (const block of [
        '## Details',
        '- Next item',
        '> results',
        '```text\npassed\n```',
        '    ```text\n    passed\n    ```',
    ]) {
        assert.equal(scanSubmissionMarkdown(`- [x] Confirmed.\n${block}\n`)[0]?.checklists[0]?.label, 'Confirmed.');
    }
});

test('fenced TAP counters remain literal and do not split sections', () => {
    const body = `## Problem

https://github.com/example/project/issues/219

## Resulting behavior

The gate rejects descriptions that omit the required verification evidence.

## Verification

\`\`\`text
# tests 586
# pass 586
# fail 0
\`\`\`

- [x] Focused tests and \`pnpm verify:push\` pass.
- [ ] Dependency or build-input changes passed \`pnpm check:security\`, when applicable.
    N/A: Dependencies and build inputs are unchanged.
- [ ] Runtime source changes include verified regenerated distribution output, when applicable.
    N/A: Runtime source is unchanged.

## Documentation

- [x] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.
- [x] The PR title and commits follow the repository policy.
- [x] Version 0.1.0 remains unreleased.
`;
    assert.equal(scanSubmissionMarkdown(body).filter((section) => section.heading !== null).length, 4);
});

test('scanner selects section depth for reuse and does not split on deeper headings', () => {
    const scanned = scanSubmissionMarkdown('### Answer\n\n#### Details\n\nready\n\n- [x] Confirmed.\n', {
        sectionLevel: 3,
    });
    assert.equal(scanned.length, 2);
    assert.equal(scanned[1]?.heading, 'Answer');
    assert.deepEqual(scanned[1]?.paragraphs, [{ text: 'ready', literal: false }]);
    assert.deepEqual(scanned[1]?.checklists, [{ label: 'Confirmed.', selected: true, continuations: [] }]);
});

test('inline comments preserve actual spaces and literal paragraph provenance', () => {
    const scanned = scanSubmissionMarkdown('## Verification\n\n<!-- hint -->checks passed\n');
    assert.deepEqual(scanned[1]?.paragraphs, [{ text: 'checks passed', literal: false }]);
    const indented = scanSubmissionMarkdown('## Verification\n\n    <!-- hint -->checks passed\n');
    assert.deepEqual(indented[1]?.paragraphs, [{ text: 'checks passed', literal: true }]);
});
