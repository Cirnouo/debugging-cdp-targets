# Changelog

Notable cumulative net changes from the latest published stable/full release
are recorded here using [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and
[SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). The initial version uses an
empty baseline. Prerelease publication preserves cumulative Unreleased changes
and copies a dated snapshot; stable publication archives the final cumulative
changes and removes delivered entries from Unreleased. Historical snapshots remain.
Version 0.1.0 remains under development; no release has been published.

## [Unreleased]

### Changed

- Support stable Node >=24.21.0 <25 while retaining Node 24.21.0 as the exact
    CI and problem-reproduction baseline. Optional mise selects everyday Node 24;
    pnpm remains exactly 12.4.2 with unchanged locks and supply-chain controls.

### Added

- MCP initialization instructions expose gateway discovery, launch isolation,
    connection/session routing and Close/Keep workflow to compatible hosts.

- Explicit project homepages in both manifests, a consumed Codex website field
    and Claude display title for GitHub self-installation.
- Explicit Codex Skill discovery and host-only title, description and shared
    Plugin icon metadata, with exact shared instruction and overlay inventories.
- A dated independent host metadata record and contributor research requirement
    before implementing new hosts or changing their metadata contracts.
- Installed metadata and complete explicit Skill context acceptance on Windows
    with Codex CLI 0.161.0 and Claude Code 2.1.294. Manual Codex Desktop
    26.1002.52244 acceptance confirms the project website, Skill title/description/
    icons and full long description. Automatic starter prompt injection remains
    unverified.
- Complete Codex same-version refresh instructions: upgrade the Marketplace,
    then reinstall the current Plugin payload to refresh its installed cache.

- A project README with a themed icon, a short host-specific quick start and a
    topic-based user guide for installation, operation, compatibility and privacy.
- Three Codex starter prompts for screenshot capture, console/network diagnosis
    and page-load performance profiling.
- A generated geometric project icon with theme-aware README artwork, universal
  Codex base icons, a Codex dark variant and a universal Claude directory icon.
- Independent Codex and Claude Code Plugins and Marketplace catalogs, each with
  a complete runtime and shared application-agnostic debugging instructions.
  Claude Code 2.1.283 is the first supported and accepted baseline.
- Explicitly authorized tag-triggered stable and prerelease GitHub source releases
  with cumulative Changelog-based notes, new contributor attribution, and required
  security and cross-platform CI gates. Arbitrary legal SemVer prerelease labels
  preserve the latest stable release as the comparison baseline and GitHub latest.
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
  Failed startup retains its primary phase and error code when rollback also
  fails, with the owned target identity available for explicit recovery.
- Structured executable/args/cwd/env launches with native Windows privilege
  detection, private one-shot elevation, actual app handles and separate
  authorization and CDP readiness waits. Independently verified generic
  application recipes can select a Chromium screenshot surface through existing
  launch arguments; changed arguments use normal Close followed by a fresh start.
- Timeout quarantine, pending transport cleanup and phase-only diagnostics;
  normal close without a listener and explicit retries after native failures.
- Required explicit no-isolation or data-directory start intent, with researched
    application bindings and Agent guidance for full/partial/unsupported/unknown
    isolation support. Every launch in both modes uses a conservative read-only
    occupancy gate, without singleton-capability exemptions or guessed generic roots.
- Ordered directory choices: Agent selection, explicit Chrome-only preset at the
    former home-relative location, existing directory, or new parent/optional name.
    Program-owned exclusive named/random allocation, existing-nonempty retention,
    explicit cleanup for other cases and reuse of prior whole-directory choices.
    Only selected-preset container ancestors may be prepared; none uses no preset.
- Connection-level data-directory leases across session restart and Keep/end-task,
    with preauthorized retain or whole-directory delete-on-release after all
    actual-app/native-acquisition/successor/resource users settle. Explicit original
    start metadata retains actual real path/policy/state after failed/cancelled
    startup and later cleanup; default summaries/Hooks omit directory evidence.
- Chrome native occupancy checks and launch reservations, with no implicit profile
    fallback. Gateway-local port ownership is reserved before probing and retained
    until actual exit or evidence that no app was created. Automatic updater
    scheduling is disabled only in the new process. Windows Chrome automatically
    receives one bare CDPScreenshotNewSurface feature, preserving valid unrelated
    parameters and exact restart arguments. Conflicting or ineffective input fails
    before directory acquisition/spawn and releases its transient port claim.
- Chrome extension debugging, with usage statistics and CrUX disabled by default
  and explicit overrides.
- Chrome support on Windows, Ubuntu 24.04 and macOS 15, with normal shutdown
  and hidden Windows auxiliary consoles.

### Security

- Dependency and vulnerability-exception identities use shared strict SemVer
  parsing, rejecting malformed prerelease/build identifiers and unsafe core numbers.
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
- Real-directory identity and overlap protection, opaque application binding and
    whole-directory cleanup scoped to the selected actual object. External Chrome
    occupancy prevents deletion after failed launch or before cleanup; failed
    disposal retains in-memory claim/evidence without route revival or replay.
    Hard crash or unverified exit cannot promise eventual deletion.
- Native application handle waits/events on Windows provide actual-exit evidence
  without process polling; helper exit and observer faults cannot establish app exit.
- Normal application Close is independent of unrelated CDP listeners and official
  MCP lifetime, with process identity checks and no application force kill.
