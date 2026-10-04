# Tooling implementation rules

Develop validator behavior test-first with adversarial snapshots or executable
fixtures. Every rule must inspect independently derived evidence; a validator
must not treat its own source, the payload being copied, or a deduplicated parser
result as proof that the input is safe.

Host descriptors are pure data with no file reads or release-evidence imports;
standalone lockfile preflight must work without dependencies or official evidence.
Build the shared runtime once, then assemble and independently audit both complete
host payloads. Validate canonical packaging inputs before copying, exact host file
inventories and formats, both Marketplace pointers and original official bytes.
Generated checks remain read-only and may not repair drift.

Keep tooling non-destructive and cross-platform unless a check explicitly runs
only in the Windows CI job. Centralize commit types, scopes, branches, payload
paths, and other shared grammar in one owned module, then consume that source
from hooks, CI, and audits. Parse structured formats with their real parser and
validate value types and paths, rather than approximating YAML or JSON with
regular expressions.

Maintain tooling and commitlint configuration as strict, erasable TypeScript.
The Babel AST audit parses TypeScript directly, including type-only imports,
exports and type `import()`; never erase types before checking dependencies.
Syntax checks use Babel for source and Node `--check` only for generated JS.
Independent `tsc --noEmit` covers every maintained Node file. Build scripts
produce self-contained JS with esbuild, not a TypeScript runtime dependency.

Repository and distribution audits must fail closed on malformed, ignored, or
unexpected payload content. Do not execute payload code during static audits,
do not download dependencies in tests, and do not mutate Git history, user
state, browser profiles, or globally installed Skills.

Supply-chain implementations additionally follow `security/AGENTS.md`.
`check:security` is an explicit network gate, not part of default tests or
verify:push. Do not auto-relax installation trust on failure.
`check:security:build` is an offline generated-artifact comparison and belongs
in verify:push; it must never perform registry audits or download dependencies.
