# Standalone security checker

- `check-security.mjs` is the generated Node entry containing the audit sources
  and YAML parser, runnable before project dependencies are installed.
- `THIRD-PARTY-NOTICES.txt` preserves the bundled YAML parser's ISC license.

Generate with `pnpm build:security`; verify without writing with
`pnpm check:security:build`. Do not edit generated files. `--root` is required
for both the source and generated CLI, for example `--phase lockfile --root .` from the
repository root. These files are CI tooling, never Plugin payload.
