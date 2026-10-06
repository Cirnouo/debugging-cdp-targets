## Problem

https://github.com/example/project/issues/219

## Resulting behavior

The gate rejects descriptions that omit the required verification evidence.
observations: the complete description is retained for squash validation

## Verification

Focused policy tests and pnpm verify:push passed; real browser checks were not run.

- [x] Focused tests and `pnpm verify:push` pass.
- [ ] Dependency or build-input changes passed `pnpm check:security`, when applicable.
    N/A: Dependencies and build inputs are unchanged.
- [ ] Runtime source changes include verified regenerated distribution output, when applicable.
    N/A: Runtime source is unchanged.

## Documentation

- [x] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.
- [x] The PR title and commits follow the repository policy.
- [x] Version 0.1.0 remains unreleased.

Closes #219
Refs: #220
