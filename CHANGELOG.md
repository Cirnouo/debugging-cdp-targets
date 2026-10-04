# Changelog

Notable net changes from the previous published version are recorded here
using Keep a Changelog and SemVer. The initial version uses an empty baseline.
Version 0.1.0 remains under development; no release has been published.

## [Unreleased]

### Added

- Codex Plugin and local Marketplace catalog with a bundled JavaScript runtime and
  application-agnostic debugging instructions.
- Tag-triggered GitHub source releases with Changelog-based notes, new
  contributor attribution, and required security and cross-platform CI gates.
- One reusable stdio gateway that creates independent official chrome-devtools-mcp
  1.10.1 connections for new targets, without a fixed connection limit.
- Bundled gateway using official split MCP SDK 2.2.0 with legacy stdio, roots,
  form elicitation, progress and cancellation compatibility.
- Complete unchanged official chrome-devtools-mcp 1.10.1 release delivered with
  the Plugin, with reviewed tarball/file evidence and a frozen isolated audit lock.
  Each launch verifies the delivered files and resolves the public Server bin
  relative to the Plugin; runtime npm/npx acquisition and its preload are removed.
  Automatic update checks are disabled only for the official Server child.
- Parallel official tool calls with explicit connection/session routing and
  independent progress, cancellation, exit monitoring and recovery reminders.
- Seven native MCP lifecycle/operation tools with idempotent asynchronous requests,
  bounded event waits, explicit cancellation, Close/Keep and automatic Hook results.
- Fixed complete official tool catalog with per-connection mcpArgs, activation
  recipes, actual enabled schemas and explicit workspace directory sources.
- Reuse of kept live targets and scoped upstream/router cleanup after an ended
  target exits, with retained identity for cleanup retries.
- Lifecycle status and native process exit monitoring with automatic, reviewed
  Codex MCP Tool Hooks, one reminder per active session, and explicit same-port
  recovery with fresh page identities.
- Structured executable/args/cwd/env launches with native Windows privilege
  detection, private one-shot elevation, actual app handles and separate permission
  and CDP readiness budgets. No plugin CLI, control IPC or Agent startup wrappers.
  Normal close accepts 8.3 executable paths while retaining process identity checks.
- Timeout quarantine, pending transport cleanup and phase-only diagnostics;
  absent-listener close and native failure/retry evidence.
- Chrome presets for a fixed dedicated browser profile, occupancy checks and
  launch reservations, explicit alternative directories, and preserved profiles
  during recovery. Automatic updater scheduling is disabled in the new process.
- Chrome extension debugging, with usage statistics and CrUX disabled by default
  and explicit overrides.
- Verified Windows Chrome operation with visible target windows and normal shutdown;
  auxiliary process consoles remain hidden. Linux/macOS have simulated CDP coverage.

### Security

- Target process, listener, and endpoint identity verification, loopback-only
  CDP connections, and fail-closed handling of identity mismatches.
- Normal target shutdown only, without force-killing or taking over existing
  applications; failed shutdown reports support manual recovery.
- Script-disabled Supply chain security CI gate for complete repository
  and isolated official Server vulnerability/signature audits.
- Strict release cooldown and no-downgrade dependency trust, with only the
  reviewed esbuild installation script allowed after the audit gate.
- Exact, fingerprint-bound review exceptions with a maximum 30-day lifetime;
  signature, registry and scan failures cannot be waived.

### Fixed

- Linux target creation evidence preserves kernel start tick precision, avoiding
  false identity rejection caused by the rounded `ps lstart` display while
  retaining creation-time, process/user, listener and endpoint checks.
