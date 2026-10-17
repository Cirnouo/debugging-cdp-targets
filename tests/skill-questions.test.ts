import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseDocument, stringify } from 'yaml';
import { isRecord } from '../src/shared/errors.ts';

const references = new URL('../packaging/shared/skills/debugging-cdp-targets/references/', import.meta.url);

async function readSources(): Promise<[string, string, string]> {
    const [contract, zh, en] = await Promise.all([
        readFile(new URL('question-contract.md', references), 'utf8'),
        readFile(new URL('questions.zh.md', references), 'utf8'),
        readFile(new URL('questions.en.md', references), 'utf8'),
    ]);
    return [contract, zh, en];
}
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
    'cleanup-new-preset': {
        variables: ['application', 'preset_path', 'preset_parent'],
        values: ['retain', 'delete-on-release'],
    },
    'close-keep': {
        variables: ['application', 'registration_id', 'connection_id', 'session_id', 'cleanup_policy'],
        values: ['Close', 'Keep'],
    },
    'live-recovery': {
        variables: ['application', 'registration_id', 'connection_id', 'session_id', 'failure_code'],
        values: ['restart', 'Close'],
    },
    'exit-start': {
        variables: ['application', 'registration_id', 'connection_id', 'session_id'],
        values: ['start', 'no-start'],
    },
    'tools-start': { variables: ['application', 'tool_names', 'mcp_args'], values: ['start', 'decline'] },
    'tools-restart': {
        variables: ['application', 'registration_id', 'connection_id', 'session_id', 'tool_names', 'mcp_args'],
        values: ['restart', 'decline'],
    },
    'replace-launch': {
        variables: ['application', 'registration_id', 'connection_id', 'session_id', 'old_args', 'start_proposal'],
        values: ['close-start', 'decline'],
    },
    'native-picker': {
        variables: ['application', 'registration_id', 'connection_id', 'session_id', 'dialog_label'],
        values: ['completed', 'cancelled'],
    },
    'missing-input': { variables: ['application', 'required_fields'], values: [] },
    'application-input': { variables: [], values: [] },
    'input-correction': {
        variables: ['application', 'field_label', 'field_constraint', 'validation_issue'],
        values: [],
    },
    'answer-clarification': { variables: ['template_id', 'quoted_answer'], values: [] },
    'target-input': { variables: ['candidates'], values: [] },
    'cancel-intent': { variables: ['registration_id', 'operation_id'], values: ['cancel-wait', 'cancel-operation'] },
};
const triggers = {
    'isolation-needed': 'isolation-intent',
    'partial-support': 'partial-isolation',
    'directory-needed': 'directory-choice',
    'existing-path-missing': 'existing-directory-input',
    'new-parent-missing': 'new-directory-input',
    'new-named-parent-missing': 'missing-input',
    'cleanup-existing-needed': 'cleanup-existing',
    'cleanup-new-named-needed': 'cleanup-new-named',
    'cleanup-new-random-needed': 'cleanup-new-random',
    'cleanup-new-preset-needed': 'cleanup-new-preset',
    'task-ending': 'close-keep',
    'live-connection-failure': 'live-recovery',
    'active-unexpected-exit': 'exit-start',
    'tools-before-start': 'tools-start',
    'tools-on-live-connection': 'tools-restart',
    'launch-args-change': 'replace-launch',
    'native-picker-unavailable': 'native-picker',
    'required-input-unresolved': 'missing-input',
    'application-unresolved': 'application-input',
    'invalid-input': 'input-correction',
    'ambiguous-answer': 'answer-clarification',
    'ambiguous-target': 'target-input',
    'ambiguous-cancellation': 'cancel-intent',
};
const noticeOnly = [
    'unsupported-isolation',
    'unknown-isolation',
    'unexpressible-isolation',
    'occupied-or-unverifiable',
    'existing-nonempty-retain',
    'unsupported-tool',
    'expected-exit',
    'inactive-exit',
    'close-wait',
    'version-mismatch',
];
const fieldIds = [
    'application',
    'version',
    'executable',
    'launch-args',
    'cwd',
    'env',
    'existing-directory',
    'new-parent',
    'new-name',
    'mcp-args',
    'task',
    'file-path',
];

function readBlock(markdown: string, kind: string): Record<string, unknown> {
    const blocks = [...markdown.matchAll(/^```yaml (dct-question-(?:contract|locale))\n([\s\S]*?)^```$/gm)].filter(
        (match) => match[1] === kind,
    );
    assert.equal(blocks.length, 1, `one authoritative ${kind} block is required`);
    const document = parseDocument(blocks[0]?.[2] ?? '');
    assert.deepEqual(document.errors, [], 'catalogue YAML must reject duplicate or malformed mappings');
    const value: unknown = document.toJS();
    assert.ok(isRecord(value));
    return value;
}

function readCatalogue(contractMarkdown: string, zhMarkdown: string, enMarkdown: string): Record<string, unknown> {
    const contract = readBlock(contractMarkdown, 'dct-question-contract');
    assert.deepEqual(Object.keys(contract).sort(), ['fields', 'notice_only', 'templates', 'triggers']);
    assert.deepEqual(contract.fields, fieldIds, 'common field IDs retain their registry order');
    assert.ok(isRecord(contract.templates));
    assert.deepEqual(Object.keys(contract.templates).sort(), Object.keys(requirements).sort());
    const fields: Record<string, unknown> = {};
    const templates: Record<string, unknown> = {};
    for (const id of fieldIds) fields[id] = {};
    for (const [id, expected] of Object.entries(requirements)) {
        const template: unknown = contract.templates[id];
        assert.ok(isRecord(template));
        assert.deepEqual(Object.keys(template), ['variables']);
        assert.deepEqual(template.variables, expected.variables, `${id}: common fact slots`);
        templates[id] = { variables: template.variables };
    }
    for (const [language, markdown] of [
        ['zh', zhMarkdown],
        ['en', enMarkdown],
    ]) {
        assert.ok(language && markdown);
        const locale = readBlock(markdown, 'dct-question-locale');
        assert.deepEqual(Object.keys(locale).sort(), ['fields', 'language', 'templates']);
        assert.equal(locale.language, language);
        assert.ok(isRecord(locale.fields) && isRecord(locale.templates));
        assert.deepEqual(Object.keys(locale.fields), fieldIds);
        assert.deepEqual(Object.keys(locale.templates), Object.keys(contract.templates));
        for (const id of fieldIds) {
            const field = fields[id];
            assert.ok(isRecord(field));
            field[language] = locale.fields[id];
        }
        for (const id of Object.keys(requirements)) {
            const template = templates[id];
            assert.ok(isRecord(template));
            template[language] = locale.templates[id];
        }
    }
    return { fields, triggers: contract.triggers, notice_only: contract.notice_only, templates };
}

function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (isRecord(value)) return Object.values(value).flatMap(strings);
    assert.fail('template content must contain only strings, records or arrays');
}

function validateCatalogue(catalogue: Record<string, unknown>) {
    assert.deepEqual(Object.keys(catalogue).sort(), ['fields', 'notice_only', 'templates', 'triggers']);
    assert.ok(isRecord(catalogue.fields));
    assert.deepEqual(Object.keys(catalogue.fields), fieldIds, 'only registered necessary fields can be requested');
    for (const field of Object.values(catalogue.fields)) {
        assert.ok(isRecord(field));
        assert.deepEqual(Object.keys(field).sort(), ['en', 'zh']);
        for (const language of ['zh', 'en']) {
            const localized: unknown = field[language];
            assert.ok(isRecord(localized));
            assert.deepEqual(Object.keys(localized).sort(), ['constraint', 'label']);
            assert.doesNotMatch(strings(localized).join('\n'), /[我你您]|\b(?:i|me|my|we|us|our|you|your|yours)\b/i);
            assert.doesNotMatch(
                strings(localized).join('\n'),
                /\{[^}]+\}/,
                'field wording is fixed, not another free-form slot',
            );
        }
    }
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
    validateCatalogue(readCatalogue(...(await readSources())));
});

test('delegation and cleanup templates preserve actor responsibilities and actual versus future directory scope', async () => {
    const catalogue = readCatalogue(...(await readSources()));
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
        for (const id of ['cleanup-existing', 'cleanup-new-named', 'cleanup-new-random', 'cleanup-new-preset']) {
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

test('first-use Chrome preset cleanup does not require or claim a prepared parent', async () => {
    const catalogue = readCatalogue(...(await readSources()));
    assert.ok(isRecord(catalogue.templates));
    const preset = catalogue.templates['cleanup-new-preset'];
    assert.ok(isRecord(preset), 'absent preset needs a truthful pre-preparation cleanup variant');
    for (const language of ['zh', 'en']) {
        const text = strings(preset[language]).join('\n');
        assert.match(text, language === 'zh' ? /容器可能尚不存在/ : /containers may not exist/);
        assert.match(text, language === 'zh' ? /容器.*保留/ : /containers.*remain/);
        assert.doesNotMatch(text, /已验证的现有父目录|Verified existing parent/);
    }
});

test('split catalogues reject language mismatches, field drift and undeclared template slots', async () => {
    const [contract, zh, en] = await readSources();
    type Documents = [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    const original: Documents = [
        readBlock(contract, 'dct-question-contract'),
        readBlock(zh, 'dct-question-locale'),
        readBlock(en, 'dct-question-locale'),
    ];
    const mutations: ((documents: Documents) => void)[] = [
        ([common]) => {
            assert.ok(Array.isArray(common.fields));
            common.fields.reverse();
        },
        ([common]) => {
            assert.ok(isRecord(common.templates));
            const template: unknown = common.templates['directory-choice'];
            assert.ok(isRecord(template) && Array.isArray(template.variables));
            template.variables.push('context');
        },
        ([, chinese]) => {
            chinese.language = 'en';
        },
        ([, , english]) => {
            assert.ok(isRecord(english.fields));
            delete english.fields['new-parent'];
        },
        ([, , english]) => {
            assert.ok(isRecord(english.templates));
            delete english.templates['close-keep'];
        },
    ];
    for (const mutate of mutations) {
        const changed = structuredClone(original);
        mutate(changed);
        const markdown = changed.map(
            (document, index) =>
                `\`\`\`yaml dct-question-${index === 0 ? 'contract' : 'locale'}\n${stringify(document)}\`\`\``,
        );
        assert.throws(() => readCatalogue(markdown[0] ?? '', markdown[1] ?? '', markdown[2] ?? ''));
    }
});

test('question contract rejects malformed catalogues, invented actions, pronouns and fact-slot escape hatches', async () => {
    const sources = await readSources();
    for (const [index, kind] of ['dct-question-contract', 'dct-question-locale', 'dct-question-locale'].entries()) {
        const markdown = sources[index];
        assert.ok(markdown);
        assert.throws(() => readBlock(`${markdown}\n${markdown}`, kind), /one authoritative/);
        for (const yaml of ['templates: {}\ntemplates: {}', 'templates: ['])
            assert.throws(() => readBlock(`\`\`\`yaml ${kind}\n${yaml}\n\`\`\``, kind), /YAML/);
    }
    const original = readCatalogue(...sources);
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
        (catalogue) => {
            assert.ok(isRecord(catalogue.triggers));
            catalogue.triggers['active-unexpected-exit'] = 'live-recovery';
        },
        (catalogue) => {
            assert.ok(isRecord(catalogue.fields));
            catalogue.fields.reason = {
                zh: { label: '理由', constraint: '解释选择原因。' },
                en: { label: 'Reason', constraint: 'Explain the choice.' },
            };
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
