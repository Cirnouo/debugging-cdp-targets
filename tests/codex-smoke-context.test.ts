import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSuppressedSkillContext } from './smoke/codex-host.ts';

const approved = {
    name: 'debugging-cdp-targets:debugging-cdp-targets',
    description: 'Approved fixture instructions.',
    path: 'C:/Fixture/installed/skills/debugging-cdp-targets/SKILL.md',
};

test('Codex context guard permits approved metadata shared by a disabled duplicate Skill', () => {
    const duplicate = { ...approved, path: 'C:/Fixture/unrelated/SKILL.md' };
    assert.doesNotThrow(() =>
        assertSuppressedSkillContext(
            [`- ${approved.name}: ${approved.description} (${approved.path})`],
            [duplicate],
            approved,
        ),
    );
});

test('Codex context guard rejects disabled Skill paths even when metadata matches the approved Skill', () => {
    const duplicate = { ...approved, path: 'C:/Fixture/unrelated/SKILL.md' };
    assert.throws(() => assertSuppressedSkillContext([duplicate.path], [duplicate], approved));
});

test('Codex context guard rejects distinct disabled Skill summaries, descriptions and paths', () => {
    const suppressed = {
        name: 'unrelated-skill',
        description: 'Unrelated fixture instructions.',
        path: 'C:/Fixture/unrelated/SKILL.md',
    };
    for (const text of [`- ${suppressed.name}:`, suppressed.description, suppressed.path])
        assert.throws(() => assertSuppressedSkillContext([text], [suppressed], approved));
});
