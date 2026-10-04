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
- MCP support for stdio, roots, form elicitation, progress and cancellation.
- Complete unchanged official chrome-devtools-mcp 1.10.1 bundled with each Plugin,
  with integrity-verified startup and no runtime package downloads.
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
  detection, private one-shot elevation, actual app handles and separate
  authorization and CDP readiness waits.
- Timeout quarantine, pending transport cleanup and phase-only diagnostics;
  normal close without a listener and explicit retries after native failures.
- Chrome presets for a fixed dedicated browser profile, occupancy checks and
  launch reservations, explicit alternative directories, and preserved profiles
  during live restart. Gateway-local port ownership is reserved before probing
  and retained until actual exit or evidence that no app was created.
  Automatic updater scheduling is disabled in the new process.
- Chrome extension debugging, with usage statistics and CrUX disabled by default
  and explicit overrides.
- Chrome support on Windows, Ubuntu 24.04 and macOS 15, with normal shutdown
  and hidden Windows auxiliary consoles.

### Security

- Integrity verification rejects observed file replacement or mutation in
  bundled release files and review evidence.
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
- Private vulnerability reporting, dependency alerts and weekly supply-chain audits.
- Protected source changes require pull requests, CodeQL analysis and security checks.
- Actual application exit revokes routes and cancels pending work before cleanup.
- Native application handle waits/events on Windows provide actual-exit evidence
  without process polling; helper exit and observer faults cannot establish app exit.
- Normal application Close is independent of unrelated CDP listeners and official
  MCP lifetime, with process identity checks and no application force kill.
