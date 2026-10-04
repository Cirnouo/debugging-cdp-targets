import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ReleaseIO } from '../tooling/release.ts';
import {
    buildReleaseBody,
    extractChangelog,
    GitHubApiError,
    parseReleaseTag,
    releaseContext,
    runRelease,
    verifyTagIdentity,
} from '../tooling/release.ts';

const sha = 'a'.repeat(40);
const tagObject = 'b'.repeat(40);
const repository = 'example/project';
const tag = 'v1.2.3';
const input = { repository, tag, sha, tagObject };
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

test('release tags require an exact stable three-component SemVer without leading zeros', () => {
    assert.equal(parseReleaseTag('v0.1.0'), '0.1.0');
    assert.equal(parseReleaseTag('v12.34.56'), '12.34.56');
    for (const value of ['v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2', '1.2.3', 'v1.2.3-rc.1', 'v1.2.3+build', 'v1.2.3\n']) {
        assert.throws(() => parseReleaseTag(value), /tag/i, value);
    }
});

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

test('release CLI accepts only a matching, newly created tag push context', () => {
    const environment = {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_REF_NAME: tag,
        GITHUB_REF: `refs/tags/${tag}`,
        GITHUB_REPOSITORY: repository,
        GITHUB_SHA: sha,
    };
    const event = { ref: `refs/tags/${tag}`, created: true, deleted: false, forced: false, after: tagObject };
    assert.deepEqual(releaseContext(environment, event), input);
    for (const override of [{ created: false }, { deleted: true }, { forced: true }, { ref: 'refs/heads/main' }]) {
        assert.throws(() => releaseContext(environment, { ...event, ...override }), /push/i);
    }
    for (const after of [undefined, null, 'main', '0'.repeat(40), `${tagObject}\n`]) {
        assert.throws(() => releaseContext(environment, { ...event, after }), /identity|push/i);
    }
    for (const override of [
        { GITHUB_EVENT_NAME: 'workflow_dispatch' },
        { GITHUB_REF_TYPE: 'branch' },
        { GITHUB_SHA: 'main' },
        { GITHUB_REPOSITORY: '../project' },
    ]) {
        assert.throws(() => releaseContext({ ...environment, ...override }, event));
    }
});

function fixture(options: { existing?: 'draft' | 'published'; latest?: boolean; failure?: string } = {}) {
    const calls: { method: string; endpoint: string; body?: Record<string, unknown> }[] = [];
    const files = new Map([
        ['package.json', JSON.stringify({ version: '1.2.3' })],
        ['packaging/codex/.codex-plugin/plugin.json', JSON.stringify({ version: '1.2.3' })],
        ['packaging/claude-code/.claude-plugin/plugin.json', JSON.stringify({ version: '1.2.3' })],
        ['plugins/codex/debugging-cdp-targets/.codex-plugin/plugin.json', JSON.stringify({ version: '1.2.3' })],
        ['plugins/claude-code/debugging-cdp-targets/.claude-plugin/plugin.json', JSON.stringify({ version: '1.2.3' })],
        ['LICENSE', 'MIT license\n'],
        ['plugins/codex/debugging-cdp-targets/LICENSE', 'MIT license\n'],
        ['plugins/claude-code/debugging-cdp-targets/LICENSE', 'MIT license\n'],
        [
            'packaging/shared/skills/debugging-cdp-targets/SKILL.md',
            '---\nmetadata:\n    version: "1.2.3"\n---\n# Skill\n',
        ],
        ['CHANGELOG.md', changelog],
    ]);
    const url = `https://github.com/${repository}/releases/tag/${tag}`;
    const release = (draft: boolean) => ({ id: 17, tag_name: tag, draft, prerelease: false, html_url: url });
    const io: ReleaseIO = {
        git(args) {
            if (args[0] === 'cat-file') return 'tag';
            if (args[0] === 'merge-base') return '';
            return args.includes(`refs/tags/${tag}`) ? tagObject : sha;
        },
        async readFile(file) {
            const contents = files.get(file);
            assert.notEqual(contents, undefined, file);
            return contents ?? '';
        },
        async request(method, endpoint, body) {
            calls.push({ method, endpoint, ...(body === undefined ? {} : { body }) });
            if (options.failure === endpoint) throw new GitHubApiError(503, 'Service unavailable');
            if (endpoint === `/repos/${repository}/releases/tags/${tag}`) {
                if (options.existing !== 'published') throw new GitHubApiError(404, 'Not found');
                return release(false);
            }
            if (endpoint === `/repos/${repository}/releases?per_page=100&page=1`)
                return options.existing === 'draft' ? [release(true)] : [];
            if (endpoint === `/repos/${repository}/releases/latest`) {
                if (!options.latest) throw new GitHubApiError(404, 'Not found');
                return {
                    id: 16,
                    tag_name: 'v1.2.2',
                    draft: false,
                    prerelease: false,
                    html_url: 'https://github.com/example/project/releases/tag/v1.2.2',
                };
            }
            if (endpoint === `/repos/${repository}/releases/generate-notes`) return { body: generated };
            if (endpoint === `/repos/${repository}/git/ref/tags/${tag}`)
                return { object: { type: 'tag', sha: tagObject } };
            if (method === 'POST' && endpoint === `/repos/${repository}/releases`) return release(true);
            if (method === 'PATCH' && endpoint === `/repos/${repository}/releases/17`)
                return release(body?.draft !== false);
            assert.fail(`Unexpected request: ${method} ${endpoint}`);
        },
    };
    return { io, calls, files, url };
}

test('release orchestration creates a draft, then publishes with Changelog notes and no added assets', async () => {
    const { io, calls, url } = fixture({ latest: true });
    assert.deepEqual(await runRelease(input, io), { status: 'published', url });
    const writes = calls.filter(
        (call) => call.endpoint.endsWith('/releases') || call.endpoint.endsWith('/releases/17'),
    );
    assert.deepEqual(
        writes.map((call) => [call.method, call.body?.draft]),
        [
            ['POST', true],
            ['PATCH', false],
        ],
    );
    assert.equal(writes[0]?.body?.name, tag);
    assert.equal(Object.hasOwn(writes[0]?.body ?? {}, 'target_commitish'), false);
    assert.equal(writes[0]?.body?.prerelease, false);
    assert.match(String(writes[0]?.body?.body), /### Added/);
    assert.doesNotMatch(String(writes[0]?.body?.body), /noisy PR title|wrong\.\.\.range/);
    assert.equal(calls.find((call) => call.endpoint.endsWith('/generate-notes'))?.body?.previous_tag_name, 'v1.2.2');
    assert.equal(calls.filter((call) => call.endpoint.includes('/git/ref/')).length, 2);
    assert.equal(
        calls.some((call) => /immutable|assets/.test(call.endpoint)),
        false,
    );
});

test('historical tag publication does not request workflow permissions through target_commitish', async () => {
    for (const existing of [undefined, 'draft'] as const) {
        const { io, calls } = fixture(existing ? { existing } : {});
        const request = io.request;
        io.request = async (method, endpoint, body) => {
            if (Object.hasOwn(body ?? {}, 'target_commitish')) {
                throw new GitHubApiError(403, 'Historical target requires Workflows: write');
            }
            return request(method, endpoint, body);
        };
        assert.equal((await runRelease(input, io)).status, 'published');
        assert.ok(calls.filter((call) => call.method !== 'GET').every((call) => call.body?.tag_name === tag));
    }
});

test('first release generation omits a previous tag and uses commit history', async () => {
    const { io, calls } = fixture();
    await runRelease(input, io);
    const generation = calls.find((call) => call.endpoint.endsWith('/generate-notes'));
    assert.equal(Object.hasOwn(generation?.body ?? {}, 'previous_tag_name'), false);
    assert.match(String(calls.find((call) => call.endpoint.endsWith('/releases'))?.body?.body), /\/commits\/v1\.2\.3/);
});

test('a matching published release is skipped without rewriting notes or creating a draft', async () => {
    const { io, calls, url } = fixture({ existing: 'published' });
    assert.deepEqual(await runRelease(input, io), { status: 'skipped', url });
    assert.ok(calls.every((call) => call.method === 'GET'));
    assert.equal(
        calls.some((call) => call.endpoint.endsWith('/generate-notes')),
        false,
    );
});

test('a matching draft resumes without creating or deleting releases', async () => {
    const { io, calls } = fixture({ existing: 'draft' });
    await runRelease(input, io);
    assert.deepEqual(
        calls.filter((call) => call.method === 'PATCH').map((call) => call.body?.draft),
        [true, false],
    );
    assert.equal(
        calls.some((call) => call.method === 'POST' && call.endpoint.endsWith('/releases')),
        false,
    );
});

test('draft discovery follows pagination when a tag lookup cannot see the draft', async () => {
    const { io, calls } = fixture();
    const request = io.request;
    let secondPage = false;
    io.request = async (method, endpoint, body) => {
        if (endpoint.endsWith('/releases?per_page=100&page=1')) {
            return Array.from({ length: 100 }, (_, index) => ({
                id: index + 100,
                tag_name: `v2.0.${index}`,
                draft: false,
                prerelease: false,
                html_url: `https://github.com/${repository}/releases/tag/v2.0.${index}`,
            }));
        }
        if (endpoint.endsWith('/releases?per_page=100&page=2')) {
            secondPage = true;
            return [
                {
                    id: 17,
                    tag_name: tag,
                    draft: true,
                    prerelease: false,
                    html_url: `https://github.com/${repository}/releases/tag/${tag}`,
                },
            ];
        }
        return request(method, endpoint, body);
    };
    assert.equal((await runRelease(input, io)).status, 'published');
    assert.equal(secondPage, true);
    assert.equal(
        calls.some((call) => call.method === 'POST' && call.endpoint.endsWith('/releases')),
        false,
    );
});

test('malformed release-list responses block draft creation', async () => {
    const { io, calls } = fixture();
    const request = io.request;
    io.request = async (method, endpoint, body) =>
        endpoint.includes('/releases?') ? { releases: [] } : request(method, endpoint, body);
    await assert.rejects(runRelease(input, io), /release/i);
    assert.equal(
        calls.some((call) => call.method === 'POST' && call.endpoint.endsWith('/releases')),
        false,
    );
});

test('invalid tag, identity, metadata, or Changelog blocks all GitHub requests', async () => {
    const cases = [
        (f: ReturnType<typeof fixture>) => {
            f.io.git = () => 'commit';
        },
        (f: ReturnType<typeof fixture>) => {
            f.io.git = (args) => (args[0] === 'cat-file' ? 'tag' : 'c'.repeat(40));
        },
        (f: ReturnType<typeof fixture>) => {
            f.files.set('package.json', '{"version":"1.2.4"}');
        },
        (f: ReturnType<typeof fixture>) => {
            f.files.set('packaging/codex/.codex-plugin/plugin.json', '{"version":null}');
        },
        (f: ReturnType<typeof fixture>) => {
            f.files.set('packaging/shared/skills/debugging-cdp-targets/SKILL.md', '---\nmetadata: null\n---\n');
        },
        (f: ReturnType<typeof fixture>) => {
            f.files.set('CHANGELOG.md', '## [Unreleased]\n- Pending.\n');
        },
        (f: ReturnType<typeof fixture>) => {
            f.io.git = (args) => {
                if (args[0] === 'merge-base') throw new Error('Not on main');
                return args[0] === 'cat-file' ? 'tag' : sha;
            };
        },
    ];
    for (const configure of cases) {
        const f = fixture();
        configure(f);
        await assert.rejects(runRelease(input, f.io));
        assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    await assert.rejects(runRelease({ ...input, tag: 'v1.2.3-rc.1' }, f.io));
    assert.equal(f.calls.length, 0);
});

test('replacing an annotated tag with another object at the same commit blocks the original push', async () => {
    const { io, calls } = fixture();
    const git = io.git;
    const request = io.request;
    io.git = (args) => (args.includes(`refs/tags/${tag}`) && args[0] === 'rev-parse' ? 'c'.repeat(40) : git(args));
    io.request = async (method, endpoint, body) =>
        endpoint.includes('/git/ref/')
            ? { object: { type: 'tag', sha: 'c'.repeat(40) } }
            : request(method, endpoint, body);
    await assert.rejects(runRelease(input, io), /tag.*(?:object|identity)/i);
    assert.equal(calls.length, 0);
});

test('API lookup failures do not masquerade as missing releases', async () => {
    for (const endpoint of [
        `/repos/${repository}/releases/tags/${tag}`,
        `/repos/${repository}/releases/latest`,
        `/repos/${repository}/releases/generate-notes`,
    ]) {
        const { io, calls } = fixture({ failure: endpoint });
        await assert.rejects(runRelease(input, io), /unavailable/i);
        assert.equal(
            calls.some((call) => call.endpoint.endsWith('/releases') && call.method === 'POST'),
            false,
        );
    }
});

test('moved remote tags and malformed generated notes stop before draft creation', async () => {
    for (const badEndpoint of ['/git/ref/', '/generate-notes']) {
        const { io, calls } = fixture();
        const request = io.request;
        io.request = async (method, endpoint, body) => {
            if (endpoint.includes(badEndpoint))
                return badEndpoint === '/git/ref/' ? { object: { type: 'tag', sha: 'c'.repeat(40) } } : { body: null };
            return request(method, endpoint, body);
        };
        await assert.rejects(runRelease(input, io));
        assert.equal(
            calls.some((call) => call.endpoint.endsWith('/releases') && call.method === 'POST'),
            false,
        );
    }
});

test('publication failure leaves the draft without any destructive cleanup', async () => {
    const { io, calls } = fixture();
    const request = io.request;
    io.request = async (method, endpoint, body) => {
        if (method === 'PATCH' && body?.draft === false) throw new GitHubApiError(503, 'Publish unavailable');
        return request(method, endpoint, body);
    };
    await assert.rejects(runRelease(input, io), /Publish unavailable/);
    assert.equal(calls.filter((call) => call.endpoint.endsWith('/releases')).length, 1);
    assert.ok(calls.every((call) => ['GET', 'POST', 'PATCH'].includes(call.method)));
});

test('Git identity uses an annotated tag and accepts historical main commits but rejects other ancestry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dct-release-git-'));
    const globalConfig = path.join(directory, 'empty-git-config');
    await writeFile(globalConfig, '');
    const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    );
    const git = (args: readonly string[]) =>
        execFileSync('git', [...args], {
            cwd: directory,
            encoding: 'utf8',
            windowsHide: true,
            stdio: 'pipe',
            env: { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig },
        }).trim();
    try {
        git(['init', '--initial-branch=main']);
        git(['config', 'user.name', 'Release test']);
        git(['config', 'user.email', 'release@example.invalid']);
        await writeFile(path.join(directory, 'file.txt'), 'first\n');
        git(['add', 'file.txt']);
        git(['-c', 'core.hooksPath=', 'commit', '-m', 'test(release): initial fixture']);
        const first = git(['rev-parse', 'HEAD']);
        git(['tag', '-a', 'v1.2.3', '-m', 'Release fixture']);
        const firstTagObject = git(['rev-parse', 'refs/tags/v1.2.3']);
        git(['tag', 'v1.2.4']);
        await writeFile(path.join(directory, 'file.txt'), 'second\n');
        git(['add', 'file.txt']);
        git(['-c', 'core.hooksPath=', 'commit', '-m', 'test(release): advance main']);
        git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
        git(['checkout', '--detach', first]);
        assert.equal(verifyTagIdentity('v1.2.3', first, firstTagObject, git), firstTagObject);
        assert.throws(() => verifyTagIdentity('v1.2.4', first, first, git), /annotated/i);
        assert.throws(() => verifyTagIdentity('v1.2.3', 'd'.repeat(40), firstTagObject, git), /commit/i);
        git(['tag', '-f', '-a', 'v1.2.3', '-m', 'Replaced annotation at the same commit']);
        assert.equal(git(['rev-parse', 'refs/tags/v1.2.3^{commit}']), first);
        assert.throws(() => verifyTagIdentity('v1.2.3', first, firstTagObject, git), /tag object identity/i);
        git(['update-ref', 'refs/remotes/origin/main', first]);
        await writeFile(path.join(directory, 'file.txt'), 'other\n');
        git(['add', 'file.txt']);
        git(['-c', 'core.hooksPath=', 'commit', '-m', 'test(release): unmerged commit']);
        git(['tag', '-a', 'v1.2.5', '-m', 'Unmerged fixture']);
        assert.throws(
            () => verifyTagIdentity('v1.2.5', git(['rev-parse', 'HEAD']), git(['rev-parse', 'refs/tags/v1.2.5']), git),
            /main/i,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('either host input or output version and license drift blocks every remote release request', async () => {
    for (const file of [
        'packaging/claude-code/.claude-plugin/plugin.json',
        'plugins/codex/debugging-cdp-targets/.codex-plugin/plugin.json',
        'plugins/claude-code/debugging-cdp-targets/.claude-plugin/plugin.json',
        'plugins/codex/debugging-cdp-targets/LICENSE',
        'plugins/claude-code/debugging-cdp-targets/LICENSE',
    ]) {
        const f = fixture();
        f.files.set(file, file.endsWith('LICENSE') ? 'drift' : '{"version":"1.2.4"}');
        await assert.rejects(runRelease(input, f.io), /metadata|version|license/i);
        assert.equal(f.calls.length, 0);
    }
});

test('duplicate release metadata cannot hide either host version drift before publication', async () => {
    for (const file of [
        'package.json',
        'packaging/codex/.codex-plugin/plugin.json',
        'packaging/claude-code/.claude-plugin/plugin.json',
        'plugins/codex/debugging-cdp-targets/.codex-plugin/plugin.json',
        'plugins/claude-code/debugging-cdp-targets/.claude-plugin/plugin.json',
    ]) {
        const f = fixture();
        f.files.set(file, '{"version":"1.2.4","version":"1.2.3"}');
        await assert.rejects(runRelease(input, f.io), /unique|duplicate/i);
        assert.equal(f.calls.length, 0);
    }
});
