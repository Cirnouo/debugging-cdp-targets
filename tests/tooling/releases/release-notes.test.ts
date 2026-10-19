import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import test from 'node:test';

import { buildReleaseBody, extractChangelog } from '../../../tooling/releases/release-notes.ts';

const repository = 'example/project';
const tag = 'v1.2.3';
const changelog = `# Changelog

## [Unreleased]

### Added

- Not released yet.

## [1.2.3] - 2026-10-01

### Added

- Support **verified targets** and [documentation](https://example.com/docs).
  Keep this continuation and \`code\` intact.

### Security

- Verify endpoint identity.

## [1.2.2] - 2026-09-01

### Fixed

- An older change.
`;
const changes = `### Added

- Support **verified targets** and [documentation](https://example.com/docs).
  Keep this continuation and \`code\` intact.

### Security

- Verify endpoint identity.`;
const generated = `## What's Changed
* A noisy PR title by @existing in https://github.com/example/project/pull/4

## New Contributors
* @newcomer made their first contribution in https://github.com/example/project/pull/5

**Full Changelog**: https://github.com/example/project/compare/wrong...range
`;

test('Changelog extraction preserves the selected version Markdown and excludes neighboring sections', () => {
    assert.equal(extractChangelog(changelog, '1.2.3'), changes);
    assert.equal(extractChangelog(changelog.replace('2026-10-01', '2024-02-29'), '1.2.3'), changes);
    assert.throws(() => extractChangelog(changelog, '1.2.4'), /Changelog/i);
});

test('Changelog extraction rejects duplicate, empty, undated, or invalid-date release entries', () => {
    for (const source of [
        `${changelog}\n## [1.2.3] - 2026-10-01\n\n- Duplicate.\n`,
        '## [1.2.3] - 2026-10-01\n\n### Added\n',
        '## [1.2.3]\n\n- Missing date.\n',
        '## [1.2.3] - 2026-02-29\n\n- Invalid leap day.\n',
        '## [1.2.3] - 2026-13-01\n\n- Invalid month.\n',
        '## [1.2.3] - 2026-04-31\n\n- Invalid day.\n',
        '## [1.2.3] - tomorrow\n\n- Invalid date.\n',
    ]) {
        assert.throws(() => extractChangelog(source, '1.2.3'), /Changelog/i, source);
    }
});

test('Changelog headings and fake changes inside fenced examples are not release evidence', () => {
    const source = `## [Unreleased]
\`\`\`markdown
## [1.2.3] - 2026-10-01
- Example only.
\`\`\`
## [1.2.3] - 2026-10-01
### Added
- Actual change.
~~~markdown
## [9.9.9] - 2026-10-01
- An example inside the release entry.
~~~
## [1.2.2] - 2026-09-01
- Older.
`;
    assert.equal(
        extractChangelog(source, '1.2.3'),
        '### Added\n- Actual change.\n~~~markdown\n## [9.9.9] - 2026-10-01\n- An example inside the release entry.\n~~~',
    );
    assert.throws(
        () => extractChangelog('## [1.2.3] - 2026-10-01\n~~~\n- Example only.\n~~~\n', '1.2.3'),
        /Changelog/i,
    );
});

test('release body contains Changelog groups, only generated new contributors, and the selected comparison', () => {
    assert.equal(
        buildReleaseBody(changes, tag, generated, repository, 'v1.2.2'),
        `## What's Changed\n\n${changes}\n\n## New Contributors\n\n* @newcomer made their first contribution in https://github.com/example/project/pull/5\n\n**Full Changelog**: https://github.com/example/project/compare/v1.2.2...v1.2.3\n`,
    );
});

test('first releases use tag history and omit absent or empty new contributors', () => {
    for (const notes of [
        '',
        "## What's Changed\n* A PR by @someone\n",
        '## New Contributors\n\n**Full Changelog**: old',
    ]) {
        assert.equal(
            buildReleaseBody(changes, tag, notes, repository),
            `## What's Changed\n\n${changes}\n\n**Full Changelog**: https://github.com/example/project/commits/v1.2.3\n`,
        );
    }
});

test('imports and exercises supplied-value release notes without publication or I/O dependencies', () => {
    const notes = new URL('../../../tooling/releases/release-notes.ts', import.meta.url).href;
    const source = [
        "import assert from 'node:assert/strict';",
        "import { registerHooks } from 'node:module';",
        'registerHooks({ resolve(specifier, context, nextResolve) {',
        "    if (/^(?:node:)?(?:fs|child_process|process|http|https|http2|net|tls|dns|dgram)(?:\\/|$)/.test(specifier) || ['yaml', 'semver'].includes(specifier) || /(?:host-policy|version-policy|publish-release)\\.ts$/.test(specifier)) throw new Error('Forbidden release-notes dependency: ' + specifier);",
        '    return nextResolve(specifier, context);',
        '} });',
        `const notes = await import(${JSON.stringify(notes)});`,
        "assert.equal(notes.extractChangelog('## [1.2.3] - 2024-02-29\\n\\n### Added\\n\\n- Verified targets.\\n', '1.2.3'), '### Added\\n\\n- Verified targets.');",
        "assert.equal(notes.buildReleaseBody('- Verified targets.', 'v1.2.3', '## New Contributors\\n* @newcomer joined.\\n', 'example/project', 'v1.2.2'), \"## What's Changed\\n\\n- Verified targets.\\n\\n## New Contributors\\n\\n* @newcomer joined.\\n\\n**Full Changelog**: https://github.com/example/project/compare/v1.2.2...v1.2.3\\n\");",
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
