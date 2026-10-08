import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../../src/shared/errors.ts';
import type { createStdioClient } from './mcp-client.ts';

export async function isolatedCodexEnvironment(home: string): Promise<NodeJS.ProcessEnv> {
    assert.ok(path.isAbsolute(home));
    const environment: NodeJS.ProcessEnv = {};
    for (const key of [
        'PATH',
        'SystemRoot',
        'WINDIR',
        'COMSPEC',
        'PATHEXT',
        'ProgramFiles',
        'ProgramFiles(x86)',
        'PROCESSOR_ARCHITECTURE',
        'NUMBER_OF_PROCESSORS',
    ])
        if (process.env[key]) environment[key] = process.env[key];
    const temporary = path.join(home, 'temp');
    await Promise.all(
        [path.join(home, '.agents/skills'), temporary].map((directory) => mkdir(directory, { recursive: true })),
    );
    return Object.assign(environment, {
        CODEX_HOME: home,
        HOME: home,
        USERPROFILE: home,
        TEMP: temporary,
        TMP: temporary,
        // Codex can probe its default remote catalog in the background. Keep Git
        // local-only so unrelated network helpers cannot retain fixture stdio.
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_TERMINAL_PROMPT: '0',
    });
}

export async function scopedCodexSkills(app: ReturnType<typeof createStdioClient>, cwd: string) {
    const listed = await app.request('skills/list', { cwds: [cwd], forceReload: true });
    assert.ok(isRecord(listed) && Array.isArray(listed.data));
    const entry = listed.data.find(
        (value: unknown) =>
            isRecord(value) && typeof value.cwd === 'string' && path.resolve(value.cwd) === path.resolve(cwd),
    );
    assert.ok(isRecord(entry) && Array.isArray(entry.skills));
    assert.deepEqual(entry.errors, []);
    return entry.skills.map((skill: unknown) => {
        assert.ok(
            isRecord(skill) &&
                typeof skill.name === 'string' &&
                typeof skill.description === 'string' &&
                typeof skill.path === 'string' &&
                path.isAbsolute(skill.path) &&
                typeof skill.enabled === 'boolean',
        );
        return skill;
    });
}

// Windows known-folder discovery ignores HOME/USERPROFILE. Disable unrelated
// discovered Skills only in the disposable CODEX_HOME config before any thread.
export async function isolateCodexSkills(
    app: ReturnType<typeof createStdioClient>,
    cwd: string,
    pluginId: string,
    skillPath: string,
) {
    const discovered = await scopedCodexSkills(app, cwd);
    const fixture = (skill: Record<string, unknown>) =>
        skill.pluginId === pluginId &&
        skill.name === 'debugging-cdp-targets:debugging-cdp-targets' &&
        typeof skill.path === 'string' &&
        path.resolve(skill.path) === path.resolve(skillPath);
    const suppressed = discovered.filter((skill) => !fixture(skill));
    for (const skill of suppressed) {
        const response = await app.request('skills/config/write', { path: skill.path, enabled: false });
        assert.ok(isRecord(response) && response.effectiveEnabled === false);
    }
    const refreshed = await scopedCodexSkills(app, cwd);
    const enabled = refreshed.filter((skill) => skill.enabled === true);
    assert.equal(enabled.length, 1, 'Only the installed fixture Skill may be enabled before any thread starts.');
    assert.ok(enabled.every(fixture));
    const approved = enabled[0];
    assert.ok(approved);
    assert.equal(approved.scope, 'user');
    return { skills: refreshed, suppressed, approved };
}

export function assertSuppressedSkillContext(
    context: string[],
    suppressed: Record<string, unknown>[],
    approved: Record<string, unknown>,
) {
    assert.ok(typeof approved.name === 'string' && typeof approved.description === 'string');
    for (const skill of suppressed) {
        assert.ok(
            typeof skill.name === 'string' && typeof skill.path === 'string' && typeof skill.description === 'string',
        );
        const name = skill.name;
        const description = skill.description;
        const skillPath = skill.path.replaceAll('\\', '/');
        assert.ok(
            context.every(
                (text) =>
                    (name === approved.name || !text.includes(`- ${name}:`)) &&
                    !text.replaceAll('\\', '/').includes(skillPath) &&
                    (!description || description === approved.description || !text.includes(description)),
            ),
            'Disabled unrelated Skill summaries and paths must not enter actual model context.',
        );
    }
}
