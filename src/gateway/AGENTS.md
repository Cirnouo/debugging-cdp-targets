# Gateway argument, target model and diagnostic implementation

Apply root and [source instructions](../AGENTS.md) cumulatively. This delivered
Gateway slice owns deterministic argument parsing, supplied target identity and
resource models, and the existing bounded one-shot diagnostic clock. Pure argument
rules and target models may use relative dependencies in
gateway, domains and shared, but must not import diagnostics, including through
type-only imports/exports or type `import()`. Unknown Gateway files remain pure.
Only diagnostics.ts may read its existing performance.now() clock and import its
pure Diagnostic/Diagnose contract from domains/control-contract.ts. No other
clock, environment, filesystem, process, network, native or external-package
access is permitted. The same dependency restrictions apply to erased syntax.

Syntax extraction grants no authentication or live-route authority. Preserve
explicit per-request bearers, complete official `_dct` removal, validation order,
closed errors, object-rest semantics and original shallow value identity. Target
models only validate supplied evidence or describe existing resource capabilities;
port claims, acquisition, observation, rollback, normal Close and actual-exit
release remain with their current adapter/application owners. Keep
registration, continuation, execution and resource state with their current owners.

Before adding a mutable Gateway responsibility or changing this boundary, read
[repository organization](../../docs/policies/repository-organization.md) and
[instruction progressive disclosure](../../docs/policies/documentation.md#instruction-progressive-disclosure),
then review these rules and the runtime-source auditor together. This slice
provides no authority for that addition.
