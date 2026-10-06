# Standalone security checker

- `check-security.mjs` is the generated Node entry containing the audit sources
  and YAML/SemVer parsers, runnable before project dependencies are installed.
- `THIRD-PARTY-NOTICES.txt` preserves the original complete YAML ISC license,
  followed by the identified semver ISC license. Type declarations are not distributed.

Generate with `pnpm build:security`; verify without writing with
`pnpm check:security:build`. Do not edit generated files. `--root` is required
for both the source and generated CLI, for example `--phase lockfile --root .` from the
repository root. These files are CI tooling, never Plugin payload.
