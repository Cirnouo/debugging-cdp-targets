# Changelog

Notable net changes from the previous published version are recorded here
using Keep a Changelog and SemVer. The initial version uses an empty baseline.
Version 0.1.0 remains under development; no release has been published.

## [Unreleased]

### Added

- Codex Plugin and local Marketplace catalog with a bundled Node runtime and
  application-agnostic debugging instructions.
- Tag-triggered GitHub source releases with Changelog-based notes, new
  contributor attribution, and required security and cross-platform CI gates.
- One reusable stdio gateway that creates independent official chrome-devtools-mcp
  1.10.1 connections for new targets, without a fixed connection limit.
- Bundled gateway using official split MCP SDK 2.2.0 with legacy stdio, roots,
  form elicitation, progress and cancellation compatibility.
- Parallel official tool calls with explicit connection/session routing and
  independent progress, cancellation, exit monitoring and recovery reminders.
- Entry/connection/session-addressed status, start, restart, stop, and end-task commands,
  explicit Close/Keep choices, and reusable host connections after normal Close.
- Lifecycle status and native process exit monitoring with automatic, reviewed
  Codex MCP Tool Hooks, one reminder per active session, and explicit same-port
  recovery with fresh page identities.
- Shell-free launch-command templates with environment expansion and selection
  of a free, non-reserved debugging port.
- Chrome presets for a fixed dedicated browser profile, disabled automatic updater
  scheduling, and extension debugging, with
  usage statistics and CrUX disabled by default and explicit overrides.
- Verified Windows Chrome operation; Linux/macOS simulated CDP coverage, without
  a claim of verified real-application compatibility on those platforms.

### Fixed

- Silent scoped upstream/router cleanup after a kept or ended target exits, with
  retained retry identity on failure and automatic task resumption on reuse.
- Profile occupancy checks and launch reservations requiring explicit alternative
  directories, preserving original profiles during recovery without UUID fallback.
- Codex manifest packaging so the installed-version loader discovers bundled Hooks;
  isolated model-request tests cover trust, tool-boundary, Stop and idle delivery.

- Visible Windows target GUI launch so normal CloseMainWindow shutdown can
  reach the target window; auxiliary process consoles remain hidden.
- Isolated Windows browser smoke startup without Chrome's automatic updater
  scheduler, retaining actual process/listener exit checks and closure deadlines.
- Portable MCP schema declaration so Codex discovers the installed gateway;
  Marketplace smoke tests now verify Codex's MCP discovery and tool catalog.
- Short entry-specific Unix socket paths for macOS temporary directories, with
  explicit UTF-8 byte-limit validation instead of a failing socket listen.

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
