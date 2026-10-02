# Tests

- `plugin-runtime.test.ts` covers command templates, routing, lifecycle, IPC,
  Server options, identity, and launch rollback using fake targets.
- `plugin-distribution.test.ts` validates portable manifests and inventory.
- `platform-evidence.test.ts` covers Unix socket recovery, Darwin path
  evidence, and PID/path/session mismatch checks with injected I/O.
- `repository-audit.test.ts` tests AST boundaries, text-style enforcement, and
  directory documentation that preserves the root README on GitHub.
- `distribution-audit.test.ts` tests packaging comparisons, single-gateway manifests,
  required portable MCP schema declarations, and allowlists.
- `build-plugin.test.ts` checks complete transitive bundle license collection,
  nested module metadata, reviewed SDK vendored notices, unused-file exclusion,
  and rejection of changed code/maps/licenses, unknown vendors or missing licenses.
- `commit-checks.test.ts`, `governance.test.ts` validate Git rules/topology.
- `ci-config.test.ts`, `toolchain-config.test.ts`, `script-checks.test.ts`
  check automation, package gates, and syntax plans.
- `version-policy.test.ts` checks shared SemVer grammar and metadata agreement.
- `release.test.ts` checks tag/event identity, dated Changelog extraction,
  English notes, paginated draft recovery and fail-closed publication with
  simulated GitHub I/O and disposable Git fixtures. It never changes this
  repository's tags or creates real GitHub Releases.
- `supply-chain.test.ts` covers complete multi-document inventories, fail-closed
  audit/signature reports, exact bounded exceptions, installed graphs and
  lockfile preflight and upstream review-before-install with fake process
  execution; it never downloads.
- `security-build.test.ts` checks the standalone auditor without node_modules,
  its bundled license, CLI rejection and read-only generated-artifact comparison.
- `control-contract.test.ts` rejects malformed external control envelopes.
- `typescript-gates.test.ts` exercises native execution from another cwd,
  strict type-error rejection, and non-erasable syntax rejection.
- `entry-control.test.ts` checks entry/connection/session identity and command-specific schemas.
- `control-endpoint.test.ts` checks portable socket path lengths in UTF-8 bytes,
  entry/user isolation and Windows named pipe compatibility.
- `entry-lifecycle.test.ts` checks entry Keep/Close and independent lifecycle.
- `entry-runtime.test.ts` checks gateway identity, independent connections and upstream lifetime.
- `mcp-bridge.test.ts` checks official catalog/result metadata, uncapped pagination,
  output validation, legacy stdio ID-zero cancellation and lifecycle tools.
- `controller-rollback.test.ts` checks failed launch cleanup and retained evidence.
- `target-recovery.test.ts` checks manual closure and explicit same-port recovery.
- `fixtures/` owns isolated CDP processes.
- `smoke/` owns opt-in official Server, local Marketplace, and Windows visible
  console tests; these do not run in the ordinary suite.
- `AGENTS.md` sets test safety and evidence rules.

Run pnpm test or a focused Node test; real-browser integration is separate
from regression tests and must not touch existing user targets.

All maintained tests and fixtures execute as TypeScript directly in Node 24.
They are covered by the same strict no-emit typecheck as runtime and tooling.
