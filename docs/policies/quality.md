# Quality, hooks, and CI

## Maintained text

Use UTF-8, LF, a final newline, four spaces, and no tabs in maintained source,
configuration, scripts, and documentation. `.editorconfig` and
`.gitattributes` are the shared format sources.

## Tests and coverage

Develop domain behavior test-first and observe the focused test fail for the
expected reason before implementation. The regression suite must not launch or
close real user applications or download packages.

Run:

```powershell
node --test tests/cdp-session.test.mjs
node --experimental-test-coverage --test-coverage-lines=52 --test-coverage-branches=71 --test-coverage-functions=61 --test tests/cdp-session.test.mjs
```

The minimum coverage floors are 52% lines, 71% branches, and 61% functions.

## Enforcement

Task 3 owns package scripts, format/lint configuration, repository validators,
Git hooks, and CI. Those gates must derive from these policies, remain
non-destructive, and run on supported Windows and Ubuntu environments where
applicable. Hooks do not replace fresh manual verification before a completion
claim, commit, or release.
