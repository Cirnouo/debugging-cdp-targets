import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';

const source = new URL('../packaging/shared/skills/debugging-cdp-targets/SKILL.md', import.meta.url);
const requirements: Record<string, { variables: string[]; values: string[] }> = {
    'isolation-intent': { variables: ['application'], values: ['data-dir', 'none'] },
    'partial-isolation': { variables: ['application', 'scope', 'effects'], values: ['data-dir', 'none'] },
    'directory-choice': {
        variables: ['application', 'preset_path'],
        values: ['delegated', 'chrome-preset', 'existing', 'new'],
    },
    'existing-directory-input': { variables: ['application'], values: [] },
    'new-directory-input': { variables: ['application'], values: [] },
    'cleanup-existing': { variables: ['application', 'directory'], values: ['retain', 'delete-on-release'] },
    'cleanup-new-named': { variables: ['application', 'parent', 'name'], values: ['retain', 'delete-on-release'] },
    'cleanup-new-random': { variables: ['application', 'parent'], values: ['retain', 'delete-on-release'] },
};
const triggers = {
    'isolation-needed': 'isolation-intent',
    'partial-support': 'partial-isolation',
    'directory-needed': 'directory-choice',
    'existing-path-missing': 'existing-directory-input',
    'new-parent-missing': 'new-directory-input',
    'cleanup-existing-needed': 'cleanup-existing',
    'cleanup-new-named-needed': 'cleanup-new-named',
    'cleanup-new-random-needed': 'cleanup-new-random',
};
const noticeOnly = [
    'unsupported-isolation',
    'unknown-isolation',
    'unexpressible-isolation',
    'occupied-or-unverifiable',
    'existing-nonempty-retain',
];

function readCatalogue(markdown: string): Record<string, unknown> {
    const blocks = [...markdown.matchAll(/^```yaml dct-question-templates\n([\s\S]*?)^```$/gm)];
    assert.equal(blocks.length, 1, 'one authoritative question catalogue is required');
    const document = parseDocument(blocks[0]?.[1] ?? '');
    assert.deepEqual(document.errors, [], 'catalogue YAML must reject duplicate or malformed mappings');
    const value: unknown = document.toJS();
    assert.ok(isRecord(value));
    return value;
}

function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (isRecord(value)) return Object.values(value).flatMap(strings);
    assert.fail('template content must contain only strings, records or arrays');
}

function validateCatalogue(catalogue: Record<string, unknown>) {
    assert.deepEqual(Object.keys(catalogue).sort(), ['notice_only', 'templates', 'triggers']);
    const templates = catalogue.templates;
    assert.ok(isRecord(templates));
    assert.deepEqual(Object.keys(templates).sort(), Object.keys(requirements).sort());
    for (const [id, expected] of Object.entries(requirements)) {
        const template: unknown = templates[id];
        assert.ok(isRecord(template), id);
        assert.deepEqual(Object.keys(template).sort(), ['en', 'variables', 'zh']);
        assert.deepEqual(template.variables, expected.variables, `${id}: finite fact slots`);
        for (const language of ['zh', 'en']) {
            const localized: unknown = template[language];
            assert.ok(isRecord(localized), `${id}.${language}`);
            assert.deepEqual(Object.keys(localized).sort(), ['facts', 'options', 'question', 'title']);
            for (const field of ['title', 'question', 'facts']) {
                const value = localized[field];
                assert.ok(typeof value === 'string');
                assert.ok(value.trim(), `${id}.${language}.${field}`);
            }
            assert.ok(Array.isArray(localized.options));
            assert.deepEqual(
                localized.options.map((option: unknown) => {
                    assert.ok(isRecord(option));
                    assert.deepEqual(Object.keys(option).sort(), ['description', 'label', 'value']);
                    for (const field of ['description', 'label', 'value']) {
                        const value = option[field];
                        assert.ok(typeof value === 'string');
                        assert.ok(value.trim());
                    }
                    return option.value;
                }),
                expected.values,
                `${id}.${language}: actions and order are contractual`,
            );
            const text = strings(localized).join('\n');
            assert.doesNotMatch(text, /[我你您]|\b(?:i|me|my|we|us|our|you|your|yours)\b/i, 'explicit roles');
            assert.doesNotMatch(text, /推荐|\brecommended\b/i, 'no authored default or recommendation');
            const variables = [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]))];
            assert.deepEqual(variables.sort(), [...expected.variables].sort(), `${id}.${language}: used fact slots`);
            assert.doesNotMatch(text, /\{(?:context|action|question|options)\}/);
        }
    }
    assert.deepEqual(catalogue.triggers, triggers, 'all current question entrances select a canonical template');
    assert.deepEqual(catalogue.notice_only, noticeOnly, 'report-only cases do not create decisions');
    assert.ok(isRecord(catalogue.triggers));
    for (const event of noticeOnly) assert.equal(Object.hasOwn(catalogue.triggers, event), false);
}

test('shared Skill has a closed bilingual question contract with explicit roles and typed fact slots', async () => {
    validateCatalogue(readCatalogue(await readFile(source, 'utf8')));
});

test('delegation and cleanup templates preserve actor responsibilities and actual versus future directory scope', async () => {
    const catalogue = readCatalogue(await readFile(source, 'utf8'));
    assert.ok(isRecord(catalogue.templates));
    const directory = catalogue.templates['directory-choice'];
    assert.ok(isRecord(directory));
    assert.ok(isRecord(directory.zh));
    assert.equal(directory.zh.question, '隔离数据目录采用哪种位置选择方式？');
    for (const language of ['zh', 'en']) {
        const localized: unknown = directory[language];
        assert.ok(isRecord(localized));
        assert.ok(Array.isArray(localized.options));
        const existing: unknown = localized.options[2];
        const child: unknown = localized.options[3];
        assert.ok(isRecord(existing));
        assert.ok(isRecord(child));
        assert.match(
            String(existing.description),
            language === 'zh' ? /直接.*用作隔离目录/ : /directly as the isolation directory/,
        );
        assert.match(
            String(child.description),
            language === 'zh'
                ? /随机.*不与已有子目录重名/
                : /random name that does not conflict with existing child directories/,
        );
    }
    for (const language of ['zh', 'en']) {
        const localized: unknown = directory[language];
        assert.ok(isRecord(localized));
        assert.ok(Array.isArray(localized.options));
        const delegated: unknown = localized.options[0];
        assert.ok(isRecord(delegated));
        assert.equal(typeof delegated.description, 'string');
        assert.match(
            String(delegated.description),
            language === 'zh'
                ? /Agent 选择现有父目录，插件创建随机子目录/
                : /Agent selects an existing parent and Plugin creates a random child/,
        );
        for (const id of ['cleanup-existing', 'cleanup-new-named', 'cleanup-new-random']) {
            const template = catalogue.templates[id];
            assert.ok(isRecord(template));
            const text = strings(template[language]).join('\n');
            assert.match(
                text,
                language === 'zh'
                    ? /整个目录及全部内容，包括预先存在的内容/
                    : /entire directory and all contents, including pre-existing contents/,
            );
            if (id !== 'cleanup-existing') {
                assert.doesNotMatch(text, /\{directory\}/);
                assert.match(text, language === 'zh' ? /尚未创建/ : /not yet created/);
            }
        }
    }
});

test('question contract rejects malformed catalogues, invented actions, pronouns and fact-slot escape hatches', async () => {
    const markdown = await readFile(source, 'utf8');
    assert.throws(() => readCatalogue(`${markdown}\n${markdown}`), /one authoritative/);
    assert.throws(() => readCatalogue('```yaml dct-question-templates\ntemplates: {}\ntemplates: {}\n```'), /YAML/);
    const original = readCatalogue(markdown);
    const mutations: ((catalogue: Record<string, unknown>) => void)[] = [
        (catalogue) => {
            assert.ok(isRecord(catalogue.templates));
            delete catalogue.templates['isolation-intent'];
        },
        (catalogue) => {
            assert.ok(isRecord(catalogue.triggers));
            catalogue.triggers['unsupported-isolation'] = 'directory-choice';
        },
        (catalogue) => {
            assert.ok(isRecord(catalogue.templates));
            const template = catalogue.templates['directory-choice'];
            assert.ok(isRecord(template));
            delete template.en;
        },
    ];
    for (const replacement of ['Where do you want it?', '{context}', 'Recommended location']) {
        mutations.push((catalogue) => {
            assert.ok(isRecord(catalogue.templates));
            const template = catalogue.templates['directory-choice'];
            assert.ok(isRecord(template));
            assert.ok(isRecord(template.en));
            template.en.question = replacement;
        });
    }
    mutations.push((catalogue) => {
        assert.ok(isRecord(catalogue.templates));
        const template = catalogue.templates['directory-choice'];
        assert.ok(isRecord(template));
        assert.ok(isRecord(template.en));
        assert.ok(Array.isArray(template.en.options));
        template.en.options.reverse();
    });
    for (const mutate of mutations) {
        const changed = structuredClone(original);
        mutate(changed);
        assert.throws(() => validateCatalogue(changed));
    }
});
