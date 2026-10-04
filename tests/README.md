# Tests

- `plugin-runtime.test.ts` covers structured launches, routing, lifecycle,
  Server options, identity, and launch rollback using fake targets.
- `plugin-distribution.test.ts` validates portable manifests and inventory.
- `official-package.test.ts` checks frozen input agreement, exact release evidence,
  path/link rejection, complete file verification and source/packaged resolution.
- `platform-evidence.test.ts` covers Unix socket recovery, Darwin path
  evidence, precise Linux kernel creation ticks, malformed evidence rejection,
  and PID/path/session mismatch checks with injected I/O.
- `repository-audit.test.ts` tests AST boundaries, text-style enforcement, and
  directory documentation that preserves the root README on GitHub.
- `distribution-audit.test.ts` tests packaging comparisons, single-gateway manifests,
  required portable MCP schema declarations, and allowlists.
- `build-plugin.test.ts` checks complete transitive bundle license collection,
  nested module metadata, reviewed SDK vendored notices, unused-file exclusion,
  and rejection of changed code/maps/licenses, unknown vendors or missing licenses.
- `commit-checks.test.ts`, `governance.test.ts` validate Git rules/topology,
  missing forced-push bases, invalid rewritten ancestors and incomplete checkouts.
- `ci-config.test.ts`, `toolchain-config.test.ts`, `script-checks.test.ts`
  check automation, package gates, and syntax plans.
- `hook-isolation.test.ts` executes the pre-push entry point with foreign Git
  routing variables and verifies disposable fixtures leave that repository intact.
- `codeql-config.test.ts` checks scan triggers, permissions, owned-source scope,
  action pins and rejection of C# source archives missing the native helper.
- `chrome-smoke-config.test.ts` checks explicit portable executable selection,
  literal isolated launch arguments, actual Chrome version requirements and
  bounded explicit Close handling when pending CDP traffic is busy
  without starting a browser.
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
- `entry-lifecycle.test.ts` checks entry Keep/Close and independent lifecycle.
- `entry-runtime.test.ts` checks gateway identity, independent connections and upstream lifetime.
- `mcp-bridge.test.ts` checks official catalog/result metadata, uncapped pagination,
  output validation, legacy stdio ID-zero cancellation and gateway status.
- `controller-rollback.test.ts` checks failed launch cleanup and retained evidence.
- `target-recovery.test.ts` checks manual closure and explicit same-port recovery.
- `target-events.test.ts` checks silent exit monitoring, task resumption, Hook
  deduplication and isolated cleanup with retained retry identity on failure.
- `chrome-profile.test.ts` checks stable defaults, explicit directories, occupancy
  rejection, concurrent reservations and release generation safety with fake targets.
- `plugin-hooks.test.ts` checks the four automatic MCP Tool Hook declarations.
- `target-spawn.test.ts` checks visible GUI launch, detached lifetime and safe
  process options at the native child-process boundary without launching a target.
- `structured-launch.test.ts` checks literal argv/env boundaries and port expansion.
- `official-options.test.ts`, `tool-catalog.test.ts` and `connection-options.test.ts`
  verify safe options, activation recipes, variants and independent configuration.
- `operations.test.ts`, `mcp-lifecycle.test.ts` and `lifecycle-protocol.test.ts`
  cover asynchronous identity/deduplication/cursor/cancel behavior and real SDK tools.
- `close-diagnostics.test.ts`, `platform-close.test.ts` cover absent/foreign listeners,
  native failure evidence and retry identity.
- `windows-launch.test.ts` checks private native protocol and actual app observation.
- `observer-cleanup.test.ts` checks retryable observation, disconnect disposal and profile release after confirmed exit.
- `windows-native.test.ts` runs disposable ordinary Node/WinForms fixtures on Windows;
  it checks argv/cwd/env/PID/NUL stdio, limited-query identity, visible close, owned
  discovery readiness and manifest detection without UAC prompts. A real 8.3
  executable alias exercises normal close while mismatched path/time identities
  must leave the fixture running.
- `router-quarantine.test.ts` exercises unanswered HTTP/CDP cleanup and metadata privacy.
- `fixtures/` owns isolated CDP processes.
- `smoke/` owns opt-in isolated Codex Hook, cross-platform Chrome, official Server, local Marketplace, and Windows visible
  console tests; these do not run in the ordinary suite.
- `AGENTS.md` sets test safety and evidence rules.

Run pnpm test or a focused Node test; real-browser integration is separate
from regression tests and must not touch existing user targets.

All maintained tests and fixtures execute as TypeScript directly in Node 24.
They are covered by the same strict no-emit typecheck as runtime and tooling.
