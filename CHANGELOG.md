# Changelog

All notable changes are recorded here using Keep a Changelog and SemVer.
Version 0.1.0 remains under development; no release has been published.

## [Unreleased]

### Added

- Codex Plugin and local Marketplace catalog with bundled Node runtime.
- Direct official chrome-devtools-mcp 1.9.0 stdio tools.
- Temporary control channel for status, start, switch, and stop.
- Stable loopback CDP entry with verified targets and explicit Close/Keep.
- Safe launch-command templates, environment expansion, and port selection.
- Portable process layout and simulated CDP coverage.

### Changed

- Chrome recommendations enable extension tools and disable usage statistics
  and CrUX, with explicit connection-level environment overrides.
- Source and implementation rules now live outside the installable Skill.
- Shared vocabulary now lives in docs/domain-language.md.

### Removed

- Remove the empty root skills directory tree left by the Plugin migration;
  retain the Plugin's active Skill payload.
- Unreleased experimental DevTools CLI daemon, Invoke, Resume, saved sessions,
  and application-specific Obsidian instructions.
- Skills CLI and standalone npm distribution plans.

### Security

- Add a script-disabled Supply chain security CI gate for complete repository
  and isolated official Server vulnerability/signature audits.
- Require explicit release cooldown and no-downgrade installation trust; allow
  only the reviewed esbuild installation script after the audit gate.
- Add exact, fingerprint-bound review exceptions with a maximum 30-day lifetime;
  signature, registry and scan failures cannot be waived.
- Refresh the development dependency graph with reviewed Node 24 types instead
  of the trust-rejected undici-types 6.21.0 chain, without trust exclusions.
- Fail closed on listener/process mismatch; never force-kill or take over
  applications. Report failed normal shutdown for manual recovery.
