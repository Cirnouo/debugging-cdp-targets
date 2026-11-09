import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse as parseTypeScript } from '@babel/parser';
import * as t from '@babel/types';
import { readLockInventory } from '../../../tooling/security/lock-inventory.ts';
import { validateExceptions } from '../../../tooling/security/vulnerability-reviews.ts';
import { inventory, lock, now, waiver } from '../../fixtures/security-audit.ts';

test('lock inventory reads every YAML document including package-manager and optional dependencies', () => {
    assert.deepEqual(readLockInventory(lock).packages, inventory);
    for (const source of [
        '',
        '---\nimporters: {}\n',
        `${lock}\npackages: [`,
        lock.replace('ws@8.22.0:', 'ws@latest:'),
    ]) {
        assert.throws(() => readLockInventory(source));
    }
});

test('scoped and nested peer annotations do not corrupt the dependency identity', () => {
    const source = lock.replace(
        '  ws@8.22.0:\n    optionalDependencies:',
        '  ws@8.22.0(@types/node@24.13.0)(nested@1.0.0(other@2.0.0)):\n    optionalDependencies:',
    );
    assert.deepEqual(readLockInventory(source).packages, inventory);
});

for (const version of ['01.2.3', '1.2.3-01', '1.2.3-alpha..1', '1.2.3+build..1']) {
    test(`lock inventory rejects malformed SemVer ${version}`, () => {
        assert.throws(() => readLockInventory(lock.replaceAll('8.22.0', version)), /Non-registry or unpinned/);
    });
}

test('security identities preserve arbitrary legal prerelease and build versions', () => {
    for (const version of ['1.2.3-any-Channel.42+Build.001', '1.2.3+Build.001', '1.2.3-900719925474099200000']) {
        assert.deepEqual(readLockInventory(lock.replaceAll('8.22.0', version)).packages, [
            inventory[0],
            inventory[1],
            { name: 'ws', version, integrity: 'sha512-d3M=' },
        ]);
        const exceptions = validateExceptions({ schemaVersion: 1, exceptions: [{ ...waiver(), version }] }, now);
        assert.equal(exceptions[0]?.version, version);
    }
});

type Edge = readonly [string, string, 'TYPE' | 'VALUE'];
const allowed: Record<string, readonly Edge[]> = {
    'lock-inventory': [
        ['yaml', 'parseAllDocuments', 'VALUE'],
        ['../../src/domains/software-version.ts', 'isSemVer', 'VALUE'],
        ['../../src/shared/errors.ts', 'isRecord', 'VALUE'],
    ],
    'registry-reports': [['./lock-inventory.ts', 'PackageIdentity', 'TYPE']],
    'vulnerability-reviews': [
        ['../../src/domains/software-version.ts', 'isSemVer', 'VALUE'],
        ['./registry-reports.ts', 'Finding', 'TYPE'],
    ],
    'installation-policy': [
        ['../../src/shared/errors.ts', 'isRecord', 'VALUE'],
        ['../../src/shared/constants.ts', 'NPM_REGISTRY', 'VALUE'],
        ['./lock-inventory.ts', 'validateConfigurationDependencies', 'VALUE'],
    ],
};
function parsed(source: string) {
    const ast = parseTypeScript(source, {
        sourceType: 'module',
        plugins: ['typescript'],
        createImportExpressions: true,
    });
    assert.equal(ast.errors?.length ?? 0, 0);
    return ast;
}
function edges(source: string, reviewDate: boolean): Edge[] {
    const result: Edge[] = [];
    function visit(node: t.Node, ancestors: t.Node[]) {
        const parent = ancestors.at(-1);
        if (t.isImportDeclaration(node)) {
            assert.equal(node.attributes?.length ?? 0, 0, 'import attributes');
            assert.equal(node.assertions?.length ?? 0, 0, 'import assertions');
            assert.ok(!node.phase, 'import phase');
            assert.ok(node.specifiers.length > 0, 'side effect dependency');
            for (const specifier of node.specifiers) {
                assert.ok(t.isImportSpecifier(specifier), 'default or namespace dependency');
                assert.ok(!node.importKind || ['type', 'value'].includes(node.importKind), 'unknown dependency kind');
                assert.ok(
                    !specifier.importKind || ['type', 'value'].includes(specifier.importKind),
                    'unknown member kind',
                );
                result.push([
                    node.source.value,
                    t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value,
                    node.importKind === 'type' || specifier.importKind === 'type' ? 'TYPE' : 'VALUE',
                ]);
            }
        }
        if (
            (t.isExportNamedDeclaration(node) && node.source) ||
            t.isExportAllDeclaration(node) ||
            t.isTSExportAssignment(node) ||
            t.isTSNamespaceExportDeclaration(node)
        )
            assert.fail('reexport facade');
        if (t.isTSImportEqualsDeclaration(node)) assert.fail('import equals loader');
        if (t.isImportExpression(node)) assert.fail('dynamic loader');
        if (t.isTSImportType(node)) {
            assert.ok(!ancestors.some(t.isTSTypeQuery), 'typeof dependency');
            assert.ok(
                t.isStringLiteral(node.argument) && t.isIdentifier(node.qualifier) && !node.options,
                'import type shape',
            );
            result.push([node.argument.value, node.qualifier.name, 'TYPE']);
        }
        if (
            t.isIdentifier(node) &&
            [
                ...(reviewDate ? [] : ['Date']),
                'require',
                'module',
                'createRequire',
                'eval',
                'Function',
                'globalThis',
                'global',
                'self',
                'window',
                'process',
                'performance',
                'fetch',
                'WebSocket',
                'XMLHttpRequest',
            ].includes(node.name)
        ) {
            const property =
                (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
                parent.property === node &&
                !parent.computed;
            const key =
                (t.isObjectProperty(parent) || t.isObjectMethod(parent)) &&
                parent.key === node &&
                !parent.computed &&
                !(t.isObjectProperty(parent) && parent.shorthand);
            assert.ok(property || key, `forbidden capability: ${node.name}`);
        }
        for (const key of t.VISITOR_KEYS[node.type] ?? []) {
            const child = Reflect.get(node, key) as unknown;
            for (const value of Array.isArray(child) ? child : [child])
                if (value && typeof value === 'object' && 'type' in value) visit(value as t.Node, [...ancestors, node]);
        }
    }
    visit(parsed(source), []);
    return result;
}
function boundary(source: string, expected: readonly Edge[], complete = false, reviewDate = false) {
    const actual = edges(source, reviewDate);
    for (const edge of actual)
        assert.ok(
            expected.some((item) => JSON.stringify(item) === JSON.stringify(edge)),
            `unauthorized dependency: ${JSON.stringify(edge)}`,
        );
    assert.equal(new Set(actual.map((edge) => JSON.stringify(edge))).size, actual.length, 'duplicate dependency');
    if (complete)
        assert.deepEqual(
            actual.map((edge) => JSON.stringify(edge)).sort(),
            expected.map((edge) => JSON.stringify(edge)).sort(),
            'exact dependency multiset',
        );
}
test('pure security owners have exact independent dependency multisets', async () => {
    for (const [owner, expected] of Object.entries(allowed))
        boundary(
            await readFile(new URL(`../../../tooling/security/${owner}.ts`, import.meta.url), 'utf8'),
            expected,
            true,
            owner === 'vulnerability-reviews',
        );
});
test('sixteen legal dependency forms are parsed before capability refusal', () => {
    const fixtures: readonly (readonly [string, string, RegExp])[] = [
        ["import { x } from 'SOURCE';", 'ImportDeclaration', /unauthorized dependency/],
        ["import x from 'SOURCE';", 'ImportDeclaration', /default or namespace/],
        ["import * as x from 'SOURCE';", 'ImportDeclaration', /default or namespace/],
        ["import 'SOURCE';", 'ImportDeclaration', /side effect/],
        ["import type { X } from 'SOURCE';", 'ImportDeclaration', /unauthorized dependency/],
        ["import { type X, y } from 'SOURCE';", 'ImportDeclaration', /unauthorized dependency/],
        ["export { x } from 'SOURCE';", 'ExportNamedDeclaration', /reexport facade/],
        ["export * from 'SOURCE';", 'ExportAllDeclaration', /reexport facade/],
        ["export * as x from 'SOURCE';", 'ExportNamedDeclaration', /reexport facade/],
        ["export type { X } from 'SOURCE';", 'ExportNamedDeclaration', /reexport facade/],
        ["export { type X, y } from 'SOURCE';", 'ExportNamedDeclaration', /reexport facade/],
        ["type X = import('SOURCE').Y;", 'TSTypeAliasDeclaration', /unauthorized dependency/],
        ["import x = require('SOURCE');", 'TSImportEqualsDeclaration', /import equals/],
        ["import('SOURCE');", 'ExpressionStatement', /dynamic loader/],
        ["require('SOURCE');", 'ExpressionStatement', /forbidden capability: require/],
        ["require?.('SOURCE');", 'ExpressionStatement', /forbidden capability: require/],
    ];
    for (const source of ['./fingerprints.ts', 'node:fs/promises'])
        for (const [template, kind, refusal] of fixtures) {
            const code = template.replace('SOURCE', source);
            const statement = parsed(code).program.body[0];
            assert.equal(statement?.type, kind);
            if (t.isExpressionStatement(statement)) {
                const expected = template.startsWith('import(')
                    ? 'ImportExpression'
                    : template.startsWith('require?.')
                      ? 'OptionalCallExpression'
                      : 'CallExpression';
                assert.equal(statement.expression.type, expected);
            }
            if (t.isTSTypeAliasDeclaration(statement)) assert.equal(statement.typeAnnotation.type, 'TSImportType');
            if (t.isImportDeclaration(statement)) {
                if (template.startsWith('import type')) assert.equal(statement.importKind, 'type');
                if (template.startsWith('import { type')) {
                    assert.ok(t.isImportSpecifier(statement.specifiers[0]));
                    assert.equal(statement.specifiers[0].importKind, 'type');
                    assert.ok(t.isImportSpecifier(statement.specifiers[1]));
                    assert.equal(statement.specifiers[1].importKind, 'value');
                }
            }
            if (t.isExportNamedDeclaration(statement) && template.startsWith('export * as'))
                assert.equal(statement.specifiers[0]?.type, 'ExportNamespaceSpecifier');
            if (t.isExportNamedDeclaration(statement) && template.startsWith('export type'))
                assert.equal(statement.exportKind, 'type');
            if (t.isExportNamedDeclaration(statement) && template.startsWith('export { type')) {
                assert.equal(statement.exportKind, 'value');
                assert.ok(t.isExportSpecifier(statement.specifiers[0]));
                assert.equal(statement.specifiers[0].exportKind, 'type');
                assert.ok(t.isExportSpecifier(statement.specifiers[1]));
                assert.equal(statement.specifiers[1].exportKind, 'value');
            }
            if (t.isTSImportEqualsDeclaration(statement))
                assert.equal(statement.moduleReference.type, 'TSExternalModuleReference');
            assert.throws(() => boundary(code, []), refusal);
        }
});
test('erased edges, loaders, aliases and wrapped capabilities cannot widen pure owners', () => {
    const negatives = [
        "export type * from './dependency-scan.ts';",
        "import type x = require('./fingerprints.ts');",
        "import type X from './registry-reports.ts';",
        "import type * as X from './registry-reports.ts';",
        "import type { X } from './dependency-scan.ts';",
        "export type { X } from './dependency-scan.ts';",
        "type X = import('./dependency-scan.ts').ScanResult;",
        'import x = y.z;',
        "export import x = require('./fingerprints.ts');",
        "type X = typeof import('./registry-reports.ts');",
        "type X = import('./registry-reports.ts').Finding.Member;",
        "import { type Finding, assessAudit } from './registry-reports.ts';",
        "import { Finding } from './registry-reports.ts';",
        "import type { Wrong } from './registry-reports.ts';",
        "import type { Finding } from './registry-reports.ts'; import type { Finding as Other } from './registry-reports.ts';",
        'import(s);',
        "import('./' + name);",
        'import(`./fingerprints.ts`);',
        'require(source);',
        "import { x } from '\\u002e/fingerprints.ts';",
        "import { x } from '\\x6eode:fs/promises';",
        "(require)('x');",
        "(require as unknown as Loader)('x');",
        "(<Loader>require)('x');",
        "require!('x');",
        "(require satisfies Loader)('x');",
        "(0, require)('x');",
        "(require as Loader)?.('x');",
        "require<Loader>('x');",
        "const r = require; r('x');",
        'const { require: r } = globalThis;',
        "module.require('x');",
        "require.resolve('x');",
        "import { createRequire as r } from 'node:module';",
        'const x = eval;',
        'const x = Function;',
        'function f(require: Loader) {}',
        'const globalThis = {};',
        'const x = process.env;',
        'performance.now();',
        "fetch('x');",
        'new Date();',
        'const D = Date;',
        'const Date = X;',
    ];
    for (const code of negatives) {
        const statement = parsed(code).program.body[0];
        assert.ok(statement, code);
        let refusal = /dependency|loader|facade|capability|import type shape/;
        if (code === "import type x = require('./fingerprints.ts');") {
            assert.ok(t.isTSImportEqualsDeclaration(statement));
            assert.equal(statement.importKind, 'type');
            assert.equal(statement.moduleReference.type, 'TSExternalModuleReference');
            refusal = /import equals loader/;
        }
        assert.throws(() => boundary(code, allowed['vulnerability-reviews'] ?? []), refusal, code);
    }
    for (const code of [
        "import { isSemVer as legal } from '../../src/domains/software-version.ts';",
        "import type { Finding as F } from './registry-reports.ts';",
        "type F = import('./registry-reports.ts').Finding;",
    ])
        assert.doesNotThrow(() => boundary(code, allowed['vulnerability-reviews'] ?? []));
    assert.throws(() => parsed('import {'), SyntaxError);
});
