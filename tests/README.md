# Tests

- `screenshot-fixture.test.ts` rejects ambiguous/conflicting feature comparisons,
  escaped fixture files, stale/malformed screenshot diagnostics and incorrect or
  transparent pixels; cleanup failure still initiates every peer Close.

- `plugin-runtime.test.ts` covers structured launches, routing, lifecycle,
  Server options, identity, and launch rollback using fake targets.
- `plugin-distribution.test.ts` validates portable manifests and inventory.
- `icon-packaging.test.ts` checks exact host artwork metadata and delivery,
  rejects missing/unexpected assets, and exercises PNG size, dimensions, CRCs,
  truncated streams and row filters with independently constructed fixtures.
- `host-distribution.test.ts` covers both complete host inventories, manifest/MCP/Hook
  and Marketplace routing, shared bytes, independent version/license/resource drift,
  duplicate metadata, linked inputs/roots and read-only build checks.
- `official-package.test.ts` checks frozen input agreement, exact release evidence,
  path/link rejection, complete file verification and source/packaged resolution.
- `file-evidence.test.ts` reproduces path replacement and in-place mutation during
  integrity reads, checks exact bytes and confirms descriptor cleanup on failures.
- `platform-evidence.test.ts` covers Unix socket recovery, Darwin path
  evidence, independently verified hard links and bounded failure diagnostics,
  precise Linux kernel creation ticks, malformed evidence rejection,
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
  They also check predicted squash headers with PR numbers, reject invalid original PR
  descriptions and unwrapped non-merge commit bodies regardless of commit identity.
  Complete original and GitHub-wrapped message fixtures exercise ordinary body
  labels, reserved footer boundaries and adjacent trailer groups. Disposable Git
  and PR entry points verify exact message and event bytes before and after audits.
- `ci-config.test.ts`, `toolchain-config.test.ts`, `script-checks.test.ts`
  check automation, package gates, and syntax plans.
- `hook-isolation.test.ts` executes the pre-push entry point with foreign Git
  routing variables and verifies disposable fixtures leave that repository intact.
- `codeql-config.test.ts` checks scan triggers, permissions, owned-source scope,
  action pins and rejection of C# source archives missing the native helper.
- `chrome-smoke-config.test.ts` checks explicit portable executable selection,
  literal isolated launch arguments, actual Chrome version requirements and
  bounded explicit Close handling when pending CDP traffic is busy
  without starting a browser. External Close stimuli only request normal closure;
  they cannot await an inspect-only fixture, poll disappearance or invent exit evidence.
- `linux-startup-probe.test.ts` temporarily checks bounded cyclic/aggregate fetch
  diagnostics and normal cleanup of only the probe's created target, including
  retained launch failures and already confirmed rollback exit.
- `claude-smoke-config.test.ts` checks allowlisted host environments, isolated user
  paths, loopback-only model endpoints, the Claude version baseline, unknown request
  validation, actual tool-result shapes, Hook context extraction, Anthropic SSE,
  responsive subprocess I/O, error/timeout cleanup and complete output draining.
  Adversarial input/callback and resistant private-child experiments use owned
  IPC readiness before their unchanged failure deadlines. Resistant coverage
  records the actual ready child, TERM/KILL requests and native close, including
  delayed startup before PID and signal-handler initialization.
- `version-policy.test.ts` checks shared SemVer grammar, stable/release predicates,
  parser limits, arbitrary legal prerelease labels, and exact metadata agreement.
- `release.test.ts` checks stable and prerelease tag/event identity, dated Changelog
  extraction, English notes, paginated draft recovery, returned classification,
  stable-only comparisons, and fail-closed publication with
  simulated GitHub I/O and disposable Git fixtures. It never changes this
  repository's tags or creates real GitHub Releases.
- `supply-chain.test.ts` covers complete multi-document inventories, fail-closed
  audit/signature reports, strict dependency/exception SemVer, exact bounded exceptions,
  installed graphs, lockfile preflight and upstream review-before-install with fake
  process execution; it never downloads.
- `security-build.test.ts` checks the standalone auditor without node_modules,
  valid-YAML version rejection, original bundled licenses and metadata contracts,
  CLI rejection and read-only generated-artifact comparison.
- `control-contract.test.ts` rejects malformed external control envelopes.
- `typescript-gates.test.ts` exercises native execution from another cwd,
  strict type-error rejection, and non-erasable syntax rejection.
- `entry-lifecycle.test.ts` checks entry Keep/Close, confirmed exit retirement,
  live same-port restart and independent child observation for each launch.
- `entry-runtime.test.ts` checks gateway identity, independent connections and upstream lifetime.
- `mcp-bridge.test.ts` checks official catalog/result metadata, uncapped pagination,
  output validation, legacy stdio ID-zero cancellation and gateway status.
- `official-child-lifecycle.test.ts` checks immediate logical transport close,
  actual child exit, EOF-resistant Server disposal, abort during initialization
  and tools/list, retained observation and retry after cleanup failure.
- `gateway-exit-protocol.test.ts` checks early exit and late acquisition,
  pending health/request cancellation, busy Close, immutable compact Hook facts,
  replacement rollback, deleted routes and peer shutdown isolation.
- `controller-rollback.test.ts` checks failed launch cleanup and retained evidence.
- `target-recovery.test.ts` checks explicit same-port recovery, literal launch
  evidence and rejection of port races after an application is created.
- `target-ownership.test.ts` checks early application acquisition, shared gateway
  port claims before asynchronous probes, retained live resources, real child
  exit release, cancellation of pending readiness/verification and old callback
  generation safety with injected processes.
- `port-reservation.test.ts` checks synchronous exclusive port claims, independent
  gateway registries and owner-checked release without opening sockets.
- `target-events.test.ts` checks silent exit monitoring, task resumption, Hook
  deduplication and isolated cleanup with retained retry identity on failure.
- `chrome-profile.test.ts` checks stable defaults, explicit directories, occupancy
  rejection, concurrent reservations, cancelled late acquisition and release
  generation safety with fake targets.
- `plugin-hooks.test.ts` checks the four automatic MCP Tool Hook declarations.
- `hook-events.test.ts` parses actual Hook text through serialized model requests
  and nested host wrappers, preserves native string escaping, and rejects leaked
  payload fields, mismatched operation exits and pending cleanup delivery.
- `target-spawn.test.ts` checks visible GUI launch, detached lifetime and safe
  process options at the native child-process boundary without launching a target.
- `target-exit-reference.test.ts` checks real private Node subprocess exit waits,
  event-loop retention during EOF cleanup, independent waiter cancellation and
  reference release without target deadlines or process polling.
- `structured-launch.test.ts` checks literal argv/env boundaries and port expansion.
- `official-options.test.ts`, `tool-catalog.test.ts` and `connection-options.test.ts`
  verify safe options, activation recipes, variants and independent configuration.
- `operations.test.ts`, `mcp-lifecycle.test.ts` and `lifecycle-protocol.test.ts`
  cover asynchronous identity/deduplication/cursor/cancel behavior and real SDK tools.
- `close-diagnostics.test.ts`, `platform-close.test.ts` cover absent/foreign listeners,
  native failure causes through operation wrappers, retry identity and actual
  child/handle exit evidence without a target deadline or Unix process polling.
- `windows-launch.test.ts` checks synchronous actual application acquisition,
  separate close request and exit wait, helper monitoring failures and matching
  native handle receipts that supplement a lost original observer.
- `observer-cleanup.test.ts` checks retryable observation, disconnect disposal and profile release after confirmed exit.
- `windows-native.test.ts` runs disposable ordinary Node/WinForms fixtures on Windows;
  it checks argv/cwd/env/PID/NUL stdio, limited-query identity, visible close, owned
  discovery readiness and manifest detection without UAC prompts. A real 8.3
  executable alias exercises normal close while mismatched path/time identities
  must leave the fixture running. A delayed normal close remains pending past
  ten seconds and confirms the same native process handle after observer loss.
- `window-evidence.test.ts` verifies owned disposable window minimize/restore and
  rejects stale identities, replaced windows and accepted but unobserved transitions.
- `router-quarantine.test.ts` exercises unanswered HTTP/CDP cleanup and metadata privacy.
- `fixtures/` owns isolated CDP, native process and visible window test inputs.
- `smoke/` owns opt-in isolated Codex/Claude Hook, cross-platform Chrome, official Server, local Marketplace, and Windows visible
  console tests; these do not run in the ordinary suite.
- `AGENTS.md` sets test safety and evidence rules.

Run pnpm test or a focused Node test; real-browser integration is separate
from regression tests and must not touch existing user targets.

All maintained tests and fixtures execute as TypeScript directly in Node 24.
They are covered by the same strict no-emit typecheck as runtime and tooling.
