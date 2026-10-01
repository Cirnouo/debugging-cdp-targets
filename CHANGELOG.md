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
- Direct access to official chrome-devtools-mcp 1.9.0 tools over stdio.
- Local status, start, switch, and stop commands for one current target, with
  explicit Close/Keep choices and a stable CDP connection entry.
- Shell-free launch-command templates with environment expansion and selection
  of a free, non-reserved debugging port.
- Chrome presets for a dedicated browser profile and extension debugging, with
  usage statistics and CrUX disabled by default and explicit overrides.
- Verified Windows Chrome operation; Linux/macOS simulated CDP coverage, without
  a claim of verified real-application compatibility on those platforms.

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
