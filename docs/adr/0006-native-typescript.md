# ADR 0006: Native TypeScript with independent typechecking

Status: accepted, 2026-10-01. The stdio ownership statement is superseded by ADR 0007.

## Context

The unreleased 0.1.0 Plugin needs typed process, control, CDP and audit boundaries
without changing direct official MCP stdio ownership or requiring users to
install development dependencies. Tests and governance are maintained code too.

## Decision

Maintain all Node source, tests, fixtures, smoke tools and commitlint config as
strict TypeScript. Node 24.21.0 executes only erasable syntax with explicit `.ts`
imports. An independent `tsc --noEmit` checks every maintained file; esbuild
bundles the Plugin and pre-install auditor into existing self-contained JS paths.
The hidden acquisition preload is ESM TypeScript in source and generated CJS in
delivery; `--import` works in both modes, selected by a private build constant.

Babel parses TypeScript directly for syntax and dependency/policy audits,
including type-only import/export and import types. External structured data
starts as unknown and must pass runtime validation. Types stay in their owning
modules and follow the same dependency direction as values.

## Consequences

There is no tsx/ts-node, Babel transpilation, emitted development tree, handwritten
JS fallback or public library API. Generated output must match the source in
read-only build checks; users still need only Node/npm/npx. Type checking remains
separate from runtime validation and does not establish CDP target identity.
Compiler/parser/type dependencies enter the unchanged supply-chain preflight,
and changed source/bundle evidence requires review rather than waiver renewal.
