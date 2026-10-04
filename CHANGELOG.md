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
  independent progress, cancellation, exit monitoring and recovery reminders.
- Seven native MCP lifecycle/operation tools with idempotent asynchronous requests,
  bounded event waits, explicit cancellation, Close/Keep and automatic Hook results.
- Fixed complete official tool catalog with per-connection mcpArgs, activation
  recipes, actual enabled schemas and explicit workspace directory sources.
- Reuse of kept live targets and scoped upstream/router cleanup after an ended
  target exits, with retained identity for cleanup retries.
- Lifecycle status and native process exit monitoring with automatic, reviewed
  Codex and Claude Code MCP Tool Hooks, one reminder per active session, and
  explicit same-port recovery with fresh page identities.
- Structured executable/args/cwd/env launches with native Windows privilege
  detection, private one-shot elevation, actual app handles and separate
  authorization and CDP readiness waits.
- Timeout quarantine, pending transport cleanup and phase-only diagnostics;
  normal close without a listener and explicit retries after native failures.
- Chrome presets for a fixed dedicated browser profile, occupancy checks and
  launch reservations, explicit alternative directories, and preserved profiles
  during recovery. Automatic updater scheduling is disabled in the new process.
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
- Script-disabled Supply chain security CI gate for complete repository
  and isolated official Server vulnerability/signature audits.
- Strict release cooldown and no-downgrade dependency trust, with only the
  reviewed esbuild installation script allowed after the audit gate.
- Exact, fingerprint-bound review exceptions with a maximum 30-day lifetime;
  signature, registry and scan failures cannot be waived.
- Private vulnerability reporting, dependency alerts and weekly supply-chain audits.
- Protected source changes require pull requests, CodeQL analysis and security checks.
