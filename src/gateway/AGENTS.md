# Gateway arguments, target models and connection lifetimes

Apply root and [source instructions](../AGENTS.md) cumulatively. This delivered
Gateway slice owns deterministic argument parsing, supplied target identity and
resource models, structured launch/isolation rules, native argument composition,
the existing bounded one-shot diagnostic clock and the exact connection resource/
directory lifetime owners below. Pure argument
rules and target models may use relative dependencies in
gateway, domains and shared, but must not import diagnostics, including through
type-only imports/exports or type `import()`. Unknown Gateway files remain pure.
Only diagnostics.ts may read its existing performance.now() clock and import its
pure Diagnostic/Diagnose contract from domains/control-contract.ts. No other
clock, environment, filesystem, process, network, native or external-package
access is permitted except for directory-lease.ts's exact adapter capabilities
below. The same dependency restrictions apply to erased syntax.

Only connections/resource-owner.ts owns resource generations: its sole dependency
is TYPE-only ../targets/model/target-contract.ts. Only connections/directory-lease.ts
owns the connection-level directory lifetime: value/type dependencies are exactly
../../adapters/data-directory.ts and ../../adapters/fixture-diagnostics.ts; TYPE-only
dependencies are ../targets/model/isolation.ts and ./resource-owner.ts. Keep these
roles exact, with no directory-wide adapter permission or ambient clock/process/
environment/network/native access. Unknown connections files remain pure; pure
models and arguments cannot import/reexport either mutable owner, even erased.
Before changing resource or directory lifetime, read
[connections instructions](connections/AGENTS.md) and its triggered isolation rules.

Syntax extraction grants no authentication or live-route authority. Preserve
explicit per-request bearers, complete official `_dct` removal, validation order,
closed errors, object-rest semantics and original shallow value identity. Target
models only validate supplied values/evidence or describe existing resource capabilities;
port claims, acquisition, observation, rollback, normal Close and actual-exit
release remain with their current adapter/application owners. Keep
registration, continuation, execution and resource state with their current owners.
The two connections owners hold complete generation/resource and directory-lease
algorithms; Core retains registry/cleanup/retry joins and actual execution/context.

Before adding a mutable Gateway responsibility or changing this boundary, read
[repository organization](../../docs/policies/repository-organization.md) and
[instruction progressive disclosure](../../docs/policies/documentation.md#instruction-progressive-disclosure),
then review these rules and the runtime-source auditor together. This slice
provides no authority beyond the two exact connection roles already described.
