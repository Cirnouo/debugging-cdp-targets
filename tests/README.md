# Tests

- `plugin-runtime.test.mjs` covers command templates, routing, lifecycle, IPC,
  Server options, identity, and launch rollback using fake targets.
- `plugin-distribution.test.mjs` validates portable manifests and inventory.
- `platform-evidence.test.mjs` covers Unix socket recovery, Darwin path
  evidence, and PID/path/session mismatch checks with injected I/O.
- `repository-audit.test.mjs` tests AST boundaries and text-style enforcement.
- `distribution-audit.test.mjs` tests packaging comparisons and allowlists.
- `commit-checks.test.mjs`, `governance.test.mjs` validate Git rules/topology.
- `ci-config.test.mjs`, `toolchain-config.test.mjs`, `script-checks.test.mjs`
  check automation, package gates, and syntax plans.
- `supply-chain.test.mjs` covers complete multi-document inventories, fail-closed
  audit/signature reports, exact bounded exceptions, installed graphs and
  script-free upstream isolation with fake process execution; it never downloads.
- `fixtures/` owns isolated CDP processes.
- `smoke/` owns opt-in official Server, local Marketplace, and Windows visible
  console tests; these do not run in the ordinary suite.
- `AGENTS.md` sets test safety and evidence rules.

Run pnpm test or a focused Node test; real-browser integration is separate
from regression tests and must not touch existing user targets.
