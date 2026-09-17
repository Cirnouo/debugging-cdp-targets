import configConventional from '@commitlint/config-conventional';

import { COMMIT_SCOPES, COMMIT_TYPES } from './tooling/governance.mjs';

export default {
    defaultIgnores: false,
    ignores: [],
    parserPreset: {
        name: 'repository-conventional-commits',
        parserOpts: {
            headerPattern: /^(\w+)(?:\(([a-z0-9]+(?:-[a-z0-9]+)*)\))?(?:!)?: (.+)$/,
            headerCorrespondence: ['type', 'scope', 'subject'],
            noteKeywords: ['BREAKING CHANGE'],
        },
    },
    rules: {
        ...configConventional.rules,
        'body-leading-blank': [2, 'always'],
        'footer-leading-blank': [2, 'always'],
        'header-max-length': [2, 'always', 100],
        'scope-case': [2, 'always', 'kebab-case'],
        'scope-empty': [2, 'never'],
        'scope-enum': [2, 'always', COMMIT_SCOPES],
        'subject-empty': [2, 'never'],
        'subject-full-stop': [2, 'never', '.'],
        'type-enum': [2, 'always', COMMIT_TYPES],
    },
};
