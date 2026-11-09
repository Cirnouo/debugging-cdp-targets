# Repository quality operations

- `runtime-boundaries.ts` validates supplied original TypeScript source with the
  complete AST role, ambient-state and owned-child rules. It reads no repository
  files and exports only `validateRuntimeSource`.
- `audit-repository.ts` owns the actual Git inventory, file/PNG/link reads,
  directory maps, metadata, instructions, YAML/text and safety audit plus its CLI.
- `check-script-syntax.ts` keeps the complete syntax plan and operation, including
  process.execPath, Babel TypeScript parsing, generated Node checks and both
  Windows PowerShell parsers. It uses the caller's current directory.
- `check-staged-text.ts` owns selected-path reads and complete original-release
  verification before the existing formatting exemption. Its CLI uses the caller's
  current directory and returns path-specific diagnostics.
- `text-policy.ts` owns pure YAML filename and text style rules, including the
  exact GitHub filename and two frozen-lock indentation exceptions. Both effectful
  text consumers import it directly.

The old root repository-audit, check-scripts and check-text-style modules are
retired. Public package command names retain their meaning. Ancestor
[tooling rules](../AGENTS.md) apply; no independent role registry or CLI framework
is introduced. These static checks establish no native or host acceptance.
