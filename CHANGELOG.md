# Changelog

Notable net changes from the previous published version are recorded here
using Keep a Changelog and SemVer. The initial version uses an empty baseline.
Version 0.1.0 remains under development; no release has been published.

## [Unreleased]

### Added

- Independent Codex and Claude Code Plugins and Marketplace catalogs, each with
  a complete runtime and shared application-agnostic debugging instructions.
  Claude Code 2.1.283 is the first supported and accepted baseline.
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
  independent progress, cancellation, actual-exit observation and lifecycle events.
- Seven native MCP lifecycle/operation tools with idempotent asynchronous requests,
  bounded event waits, explicit cancellation, Close/Keep and automatic Hook results.
- Fixed complete official tool catalog with per-connection mcpArgs, explicit
  disabled-tool replacement recipes, actual enabled schemas and workspace sources.
- Summary discovery/lifecycle results and selected status with opt-in configuration,
  diagnostics and tool details. Unavailable upstreams expose requirements only;
  enabled tools have no activation recipe and unsupported tools give their reason.
- One session owner before resource acquisition, scoped cancellation and complete
  exit cleanup. Actual exit removes active and inactive sessions; failed resource
  disposal remains in an internal in-memory cleanup ledger.
- Reuse of kept live targets and resources with continued actual-exit observation.
  Ordinary exit retries use a new start; explicit live restart retains the connection
  and exact port while replacing the owner, router, upstream and session.
- Lifecycle status and native process exit monitoring with automatic, reviewed
  Codex and Claude Code MCP Tool Hooks, independent compact events and fresh
  page identities after live restart. Expected exits are grouped by operation ID
  with all actual exit/cleanup facts, including new Target rollback, and wait for
  related cleanup before delivery. Terminal status/wait, terminal cancel and
  identical mutation retry delivery acknowledge operation notices; aborted
  requests and nonterminal responses leave them unread. Failure notices retain
  the active failure phase and compact native evidence without error payloads.
- Structured executable/args/cwd/env launches with native Windows privilege
  detection, private one-shot elevation, actual app handles and separate permission
  and CDP readiness budgets. No plugin CLI, control IPC or Agent startup wrappers.
  Normal close accepts 8.3 executable paths while retaining process identity checks.
- Timeout quarantine, pending transport cleanup and phase-only diagnostics;
  absent-listener close and native failure/retry evidence.
- Chrome presets for a fixed dedicated browser profile, occupancy checks and
  launch reservations, explicit alternative directories, and preserved profiles
  during live restart. Gateway-local port ownership is reserved before probing
  and retained until actual exit or evidence that no app was created.
  Automatic updater scheduling is disabled in the new process.
- Chrome extension debugging, with usage statistics and CrUX disabled by default
  and explicit overrides.
- Verified Windows, Ubuntu 24.04 and macOS 15 Chrome operation with real desktop
  browser acceptance, normal shutdown and simulated CDP regression coverage.
  Windows auxiliary process consoles remain hidden.

### Security

- Descriptor-based release and review-evidence reads reject path replacement and
  observed in-place file changes during integrity verification.
- Target process, listener, and endpoint identity verification, loopback-only
  CDP connections, and fail-closed handling of identity mismatches.
- Normal target shutdown only, without force-killing or taking over existing
  applications; failed shutdown reports support manual recovery.
- Event-driven normal target Close without a target deadline. A 25-second
  operation wait bounds one response and never expires its underlying cleanup.
  Cancelled Close retains live application ownership and observation.
- Independent official Server disposal closes the public SDK transport immediately,
  rejects pending calls and proves actual child exit. Its owned child receives
  two seconds for EOF, two seconds after TERM, then KILL within a ten-second budget;
  applications remain subject only to normal Close. Gateway disconnect attempts
  every resource cleanup in parallel with target shutdown despite peer failures.
- Script-disabled Supply chain security CI gate for complete repository
  and isolated official Server vulnerability/signature audits.
- Strict release cooldown and no-downgrade dependency trust, with only the
  reviewed esbuild installation script allowed after the audit gate.
- Exact, fingerprint-bound review exceptions with a maximum 30-day lifetime;
  signature, registry and scan failures cannot be waived.
- Private vulnerability reporting, dependency alerts and weekly complete audits,
  contribution/community policies and GitHub collaboration templates.
- Protected main with PR/squash-only merging, eleven required Actions checks,
  maintained-source CodeQL analysis and high/critical security alert merge protection.

### Fixed

- Linux target creation evidence preserves kernel start tick precision, avoiding
  false identity rejection caused by the rounded `ps lstart` display while
  retaining creation-time, process/user, listener and endpoint checks.
- macOS executable evidence verifies Chrome's mapped code-sign hard link through
  the installed file's device/inode, preventing false path changes while rejecting
  different files, incomplete mapping evidence and ambiguous aliases.
- Actual application exit gates and cancels pending startup/tool work before
  cleanup, preventing blocked requests from retaining dead sessions and resources.
- Windows helper exit and observer faults no longer masquerade as actual app exit;
  reliable native application handle waits/events avoid process polling.
- Normal application Close remains independent of an unrelated CDP listener and
  official MCP lifetime, preserving identity checks and avoiding force kill.
