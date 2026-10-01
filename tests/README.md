# Tests

- `plugin-runtime.test.ts` covers command templates, routing, lifecycle, IPC,
  Server options, identity, and launch rollback using fake targets.
- `plugin-distribution.test.ts` validates portable manifests and inventory.
- `platform-evidence.test.ts` covers Unix socket recovery, Darwin path
  evidence, and PID/path/session mismatch checks with injected I/O.
- `repository-audit.test.ts` tests AST boundaries and text-style enforcement.
- `distribution-audit.test.ts` tests packaging comparisons and allowlists.
- `commit-checks.test.ts`, `governance.test.ts` validate Git rules/topology.
- `ci-config.test.ts`, `toolchain-config.test.ts`, `script-checks.test.ts`
  check automation, package gates, and syntax plans.
- `supply-chain.test.ts` covers complete multi-document inventories, fail-closed
  audit/signature reports, exact bounded exceptions, installed graphs and
  lockfile preflight and upstream review-before-install with fake process
  execution; it never downloads.
- `security-build.test.ts` checks the standalone auditor without node_modules,
  its bundled license, CLI rejection and read-only generated-artifact comparison.
- `control-contract.test.ts` rejects malformed external control envelopes.
- `typescript-gates.test.ts` exercises native execution from another cwd,
  strict type-error rejection, and non-erasable syntax rejection.
- `fixtures/` owns isolated CDP processes.
- `smoke/` owns opt-in official Server, local Marketplace, and Windows visible
  console tests; these do not run in the ordinary suite.
- `AGENTS.md` sets test safety and evidence rules.

Run pnpm test or a focused Node test; real-browser integration is separate
from regression tests and must not touch existing user targets.

All maintained tests and fixtures execute as TypeScript directly in Node 24.
They are covered by the same strict no-emit typecheck as runtime and tooling.
