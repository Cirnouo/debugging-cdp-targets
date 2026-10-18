# Singleton desktop gateway implementation plan

Goal: replace per-chat stdio gateways with one consciously launched desktop App per OS user, shared by Codex and Claude Code through Streamable HTTP on Windows, macOS and Linux.

Architecture: Electron main process embeds the native erasable TypeScript gateway core; React/TypeScript management UI uses narrow preload IPC. Official chrome-devtools-mcp remains a complete unchanged npm release, launched with separately bundled ordinary Node 24. No TUI, CLI/headless mode, service, autostart, deep links, per-chat proxy, or custom DevTools tools.

Tech: Node >=24.21.0 <25, pnpm 12.4.2, official MCP SDK, Electron, React, esbuild, electron-builder. Pin and audit reviewed dependencies. Windows 11, macOS 15 and Ubuntu 24.04 desktop, x64 and arm64, installer and portable distributions. Keep App and plugin 0.1.0 Unreleased until publication separately authorized.

Spec: the global constraints below record the user's accepted design. They supersede conflicting current stdio/Hook-only architectural rules. Current supported-behavior docs change with actual implementation; accepted forward decisions may be recorded separately.

Status: accepted forward implementation plan, 2026-10-17. Task 2 records the
contracts; the currently delivered stdio Plugin remains supported until Task 4.
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md) owns the forward architecture.
This tracked plan replaces the ignored planning copy as the durable task owner.

## Global constraints

- One App singleton per OS user, including portable/installed copies regardless of data directory. First process owns its data; later processes activate it without migration/merging. Installer uses per-user data, portable uses extracted data (macOS next to .app). Default tray/menu bar, management-window fallback where no tray exists. No runtime object restoration or cross-platform parent-death supervisor. Never force-kill target applications.
- Default loopback endpoint http://127.0.0.1:27637/mcp; port conflict is explicit failure. Enforce Host/Origin boundaries. No long-term HTTP API key. A registration bearer owns connections and jobs independently of chat/socket/MCP session. Prefer verified initialization registration when possible, ordinary register-tool fallback. Empty registrations with no resources/jobs expire after 30 minutes. Reconnect never replays start, revokes ownership or transfers it.
- Drop public entryId, taskActive, end-task, Hooks/notification injection/Stop continuations. Keep connectionId stable; new sessionId after any side restart. requestId and operationId remain distinct. One SDK request context per client; no global current roots/elicitation/progress. App/connection lifetime never follows a single client's close.
- Only launch new verified targets, one target and independent official server per connection. Agent owns only bearer resources; GUI administers all. Refuse transfer while busy; future operations change owner, old terminal operation/results retain original owner. No token readback/recovery. New registration and GUI transfer of idle resources provide recovery.
- Client cancellation/HTTP timeout detaches its wait and does not kill a healthy upstream or target. Keep connection busy until actual official execution completes; no automatic replay. Elicitation/progress use only originating request context and return an explained error if unavailable.
- Expected target exits are registered before exit using operation/PID/generation. Target-only restart retains official server. Both restart/Close/App exit clean both. Real unexpected target exit ends connection and cleans official, without auto target restart/Hook ask chain. Diagnosable single-subject failure may repair that side while preserving healthy side; repair failure cleans and reports. No whole-pair retry/escalation engine.
- Restart accepts explicit target/official/both scope and only the old successful immutable launch snapshot, including resolved environment and connection roots. New executable/args/cwd/env/MCP config requires Close then new start. Preserve target port policy (explicit fixed, automatic may change), stable router URL decouples official. Verify retained official reconnect and cache invalidation. No rollback retry chains.
- Start snapshots initiating client roots before acquiring resources, or empty roots if unsupported. Explicit workspace/default temporary directory behavior remains. Later roots updates do not retroactively change ownership; restart retains roots, transfer transfers roots. Path evidence stays explicit operation/config metadata.
- Normal App exit succeeds only after cleanup succeeds; failure retains GUI/ownership and denies new work while closing. No fake success or force target kill.
- GUI does not start targets from scratch. View registrations/connections/operations; restart explicit scope; Close; batch Close/transfer; unregister empty registrations. Connection age from first successful logical establishment, last operation excludes polling/status/wait/UI refresh; HH:MM:SS with unbounded hours.
- Persist configuration only with integer schemaVersion, pure sequential migration and validation, backup and atomic commit of whole chain after singleton acquisition. Corrupt/future schemas refuse writes. Cheap settings hot; expensive settings cold; port cold. Show desired vs effective config.
- Port workflow saves desired port, normal App restart/cleanup, successfully binds new port, then independently syncs each user-level host plugin. Display success/failure/pending host reload and retry failures; no cross-host all-or-rollback transaction.
- GUI manages only user-scope plugins using stable native CLI adapters, actual returned installation paths, re-resolution after update, own mcp URL patch and readback. Show project/local/managed copies read-only. Respect disabled and pinned installs. Config roots explicitly selectable when environment differs. App/plugin versions independent; both host plugins same logical version. Stable static latest-plugin record contains minimumAppVersion and immutable verifiable source. Automatically detect/install compatible stable updates independently of App updates; incompatible latest retains installed version and asks for App update. No history solver/backend.
- Build six OS/architecture installer+portable targets. Packaging owns Node, official release and licenses in App; thin plugins contain host manifests/Skill/assets. GitHub Releases concern App; plugin updates have independent immutable feed. Publication/tagging remains unauthorized.
- Update current repo rules/docs/tests/Skill/examples/audits/CI/build/generated output with behavior. Preserve genuine historical ADR bodies/evidence and valid application fixtures. Do not globally erase stdio/Git hooks/old version history. Remove obsolete obsidian commit scope without historical special casing (reachable history has no use). Avoid mechanical source relocation or empty packages.
- Each PR is green independently, reviewed by fresh gpt-6.1-sol Ultra agent, pushed, attached to current chat, squash merged with validated exact message; monitor CI, fast-forward local main, archive only task worktrees preserving PR attachments. User authorizes those operations. No tags/releases/settings changes.

## Task 1: Upgrade official Server independently

Upgrade chrome-devtools-mcp from 1.10.1 to the latest stable published release (research found 1.11.0 on 2026-10-17; verify registry latest). Read supply-chain official-upgrade contract. Derive fresh SHA-512 and per-file SHA-256/size evidence from canonical registry tarball, rejecting unsafe archive entries. Keep complete unchanged original release. Update root and isolated upstream locks, exact dependency, tool catalogue variants/schema/config compatibility, current version references and generated host payloads through maintained build. Do not automatically refresh evidence from installed/copied output. Research new config discovery and explicitly disable it for immutable configured launches if needed. Keep upstream stdio/old plugin architecture in this independent PR. Domain/runtime behavior changes are test-first. Run full network supply-chain gate, focused regressions, official catalogue smoke, typecheck, build/check and verify:push. Commit coherent changes after hook verification, self-review; controller handles PR/review/merge. Report embedded-library audit coverage boundary.

## Task 2: Repository and independent version contracts

Record accepted forward App architecture in ADR 0017/current indices and a durable tracked copy of this complete implementation plan, without presenting it as already delivered. Add explicit before-use forward-design pointers to contributor/source entries, retaining recognizable current stdio behavior until Task 4. Root package.json.version owns App version; the shared Skill metadata version and both maintained/generated host manifests form one independently validated plugin version group. App version may differ, both host plugin versions may not. Update every existing validator/build/audit/release consumer, including distribution-audit's direct package-version comparison, preserving all other strict parsing/release protections. Test actual distinct App/plugin versions and mismatched peer/Skill rejection. No empty package hierarchy or unused version registry/parser. Describe minimal future stable plugin record (latest stable version, minimumAppVersion, immutable git-subdir payload source SHA and verifiable integrity), with payload commit A followed by separately authorized catalog/feed B; advertise no stable feed/record while 0.1.0 is Unreleased. Remove unused obsidian commit scope and policy/test allowed value, add explicit rejection coverage; add durable app scope for desktop lifecycle/UI/config/OS integration, retaining distribution/devtools/session boundaries. No historical grammar special case or commit rewrite. Record current-to-forward distinction, atomic HTTP/Hook cutover, singleton native advisory-lock/activation-only exception and cleanup/lifecycle requirements faithfully. Read documentation progressive disclosure before instruction edits; preserve all existing critical obligations and add only owned pointers. No runtime/transport/installed Skill workflow/dependency changes in this PR. Current plugin behavior remains supported. Preserve historical ADR bodies/plans/evidence and valid application fixtures. Verify focused failing-first governance/version/build/release tests, typecheck, generated comparisons and verify:push. Commit atomic scope/version/docs changes and self-review; root handles PR/review/merge. Maintain0.1.0 Unreleased; no tags/publication/user-config/global changes.

## Task 3: Decouple core lifecycle and client context

Implement registration ownership, runtime/client decoupling, immutable roots/launch snapshots, scoped old-config restart, cancellation wait separation, expected-exit tracking, minimal shared single-side repair primitives and safe final cleanup. Keep old stdio adapter temporarily operational while preparing direct HTTP. Remove public entry identity as interfaces transition, with tests for stale generations, no replay, busy transfer and isolated client context. Remove taskActive/end-task/Hook contracts atomically with Task 4 if needed for independently green PR. Do not add durable sessions or new supervisory abstractions. Domain changes test-first; demonstrate retained official server reconnect/cache behavior through suitable fixtures/explicit smoke. Update current docs with actual behavior. Verify focused suites and verify:push.

## Task 4: Minimal App and direct HTTP atomic cutover

Deliver an actually buildable/runnable Electron App with React management window/tray, OS-user singleton, data roots, schema-migrated configuration, loopback MCP HTTP with per-client contexts and registration tools. Move official/Node delivery into App without altering official bytes. Switch thin Codex/Claude plugins to HTTP and remove old entry/Hook/end-task/taskActive together. No proxy or headless/TUI. Implement boundaries, cancellation/close semantics and startup failure UI. Pin/audit dependencies and exact scripts with evidence. Real dual-host tool-call smoke from installed thin host payloads must pass; record limitations precisely. Preserve name/icon/response as host-native MCP invocation (do not claim UI fields without actual observation). GUI control remains minimal here, fuller management Task 6. Verify packaging/static/runtime gates and native App smoke.

## Task 5: User-level plugin installation and updates

Implement two concrete stable-CLI host adapters: detect installations, install/update user-scope plugin, re-resolve actual path, patch own gateway URL/read back, preserve disabled/pinned state, distinguish reload pending. Surface read-only project/local/managed copies. Support explicit host config root override. Auto-check/install compatible published stable plugin record independently of App version; latest incompatible retains old plugin and reports App update. Static immutable verifiable source and minimumAppVersion only. No remote release publication. Test adversarial paths/output/partial failures using I/O fixtures; run explicit isolated real-host acceptance. Verify relevant suite and verify:push.

## Task 6: Complete management GUI

Implement connection/registration/operation dashboard, age and idle timers, explicit scoped restart, Close, batch transfer/Close, empty registration cleanup, configuration desired/effective state and cold port restart plus independent host sync/retry using Task 5. GUI must not create targets from scratch. Ensure cleanup failure keeps management available and ownership intact. Narrow preload IPC only, no unsafe renderer privileges. Apply frontend design/testing skills, test actual interactions visually on native App or appropriate browser fixture. Domain tests first; verify accessible states and errors, focused tests, verify:push.

## Task 7: Native distributions, CI and final semantic audit

Complete six native OS/architecture installer and portable builds, bundled supported Node, original official package, licenses/notices/integrities, platform lifecycle/tray fallbacks, release dry-run/CI artifacts. Do not claim emulated/cross-built artifacts are native-tested. No tag/publication/settings changes. Update all stale current repo content including AGENTS/Skill/policies/tooling/CI/build metadata; preserve real history. Reconcile Unreleased cumulative changelog against authoritative release baseline. Independently review whole delivered architecture, final dual-host acceptance and generated output. Each PR follows user-authorized push/attach/green CI/squash merge/main CI/local fast-forward. Archive task worktrees preserving PR associations only after completed work and ignored needed artifacts saved.

## Accepted implementation rulings

These clarify the global constraints without claiming implementation or publication.

- Admit one actual official execution per connection; overlapping admission is busy.
    Independent connections run in parallel. Retain its originating request context
    until actual execution settles after detached waits. Official executions have
    bounded in-flight state, not a second public operation/result archive. Lifecycle
    jobs retain operationId/status/wait/cancel; official names/results stay unchanged.
- Successful authenticated calls, including status, refresh empty-registration
    activity after checking expiry. Resources and nonterminal work prevent empty
    expiry; terminal history expires with its registration after 30 idle minutes.
    GUI last-real-operation timestamps exclude status/polling/wait/UI refresh.
- Task 3 retains the legacy public entry/Hook/end-task facade using an internal
    trusted registration. Task 4 removes those surfaces atomically with direct HTTP.
    Target-only restart needs retained-official reconnect/cache public-bin smoke;
    source inspection is insufficient.
- Do not use Electron requestSingleInstanceLock as the actual singleton guard: the
    inspected Chromium POSIX implementation can kill an unresponsive owner. Use an
    OS advisory file lease held until final process exit; never unlink or heartbeat
    expire its file. fs-native-extensions 1.5.1 is a candidate only, conditional on
    complete supply-chain review and six-native Electron load tests. One bounded
    activation-only local pipe/socket is the sole singleton IPC exception; it is
    not an admin/data protocol. Only the lease winner manages stale sockets. A
    loser activates or reports an unresponsive owner and never takes over.
- No stable plugin record/feed is advertised while 0.1.0 remains Unreleased. Missing
    record is ordinary unavailable-update state. Isolated native host installation
    smokes may use explicitly identified development payloads.
- Keep configured marketplace main/ref and independently verified host git-subdir
    sources pinned to immutable lowercase 40-character commit SHA. Payload commit A
    precedes separately authorized catalog/feed commit B; both catalog entries and
    latest record pin A. No private staging marketplace, remove/re-add, adoption
    framework, compatibility history solver or automatic downgrade.
- Each host preserves original source/ref/pin/disabled intent. A user installedPath
    shared with project/local/managed records is a visible conflict; never mutate
    shared bytes across scope. Claude readFromFolder is actual local source and is
    read-only even when installPath points to cache. Codex add enables; only its add
    result establishes installedPath. Unknown existing paths stay read-only unless
    a safe native operation establishes the actual path.
- Codex native upgrade must select only this marketplace. It refreshes every
    installed/configured entry in that catalog: refuse automatic refresh if unrelated
    entries, disabled/pinned copies or unmanaged/shared paths could be touched.
    Precheck feed/catalog/source/minimumAppVersion before mutation; postcheck actual
    returned path, bytes, version and pin before patching this plugin URL. External
    source movement can yield visible partial failure; do not promise host atomicity.

## Accepted Task 7 live deployment amendment — 2026-10-17

Implement the accepted [ADR 0017 amendment](../../docs/adr/0017-singleton-desktop-app.md#accepted-live-deployment-amendment--2026-10-17)
as three bounded increments. This is forward work, not current installer support.

- 7a: strict schema-version-one physical installation metadata, immutable complete
    build selection and active/removing/removed transitions; exactly two existing
    native shared/exclusive installation lock inodes and a bounded atomic state
    store with explicit pre-commit/indeterminate outcomes and adversarial real
    cross-process tests. Accept only enrolled roots. No payload staging/removal,
    startup integration, identity adoption/repair or generic inventory framework.
    Formatted hashes are not payload proof. Windows ACLs, macOS permissions/local
    filesystem evidence and system-DEB roles remain conservatively gated. These
    are hard prerequisites before 7b enables admission on those platforms; the
    existing App retains its supported platform behavior meanwhile.
- 7b: pinned complete runtime closure and installation-use admission before data
    or gateway work, preserving synchronous Chromium isolation as step zero;
    installation/account-bound closed normal quit; cleanup and actual-exit gates;
    a short external copied ordinary-Node bridge with detached launches and one
    bounded private atomic receipt ACK for overlapping successor use ownership.
    Unknown live children retain coverage; no kill/replay/timeout success or
    resident cleanup supervisor. Unprovable helper cleanup leaves owned residue.
- 7c: audited packaging inputs and custom live-safe NSIS, retained-runtime DEB,
    explicit DMG installer GUI and extracted portable integration; managed removal
    retains configuration/plugins and lock tombstone, refuses remaining readers,
    and never deletes a live payload. Complete native six-cell installer/portable
    acceptance and final bilingual docs, CI and cumulative Unreleased audit.

Updates commit only next-launch selection after independently verifying complete
immutable payloads; they leave a live App's pinned files, configuration, HTTP and
children untouched. Normal restart selects the new build only after cleanup and
actual old-owner exit. Two builds may share SemVer but not content identity.
Do not prune or solve rollback/history. Supplied managed callbacks exclude manual
Trash/rm, forced package overrides and overlay extraction. No App updater,
autostart, service, public administrative API, tags or publication is authorized.

Each increment keeps independently green source, fresh Ultra review, actual
generated pre-push verification, current-head CI, controlled squash/main CI/local
fast-forward and owned-worktree archive. Parallel private 7a starts only from a
committed App foundation; actual App/host/GUI producers precede final ordered
integration and remote delivery.

## Verification and completion ownership

The scoped Task 2 contracts are independently green before runtime work. Later
PRs update current instructions, protocol, inventories and evidence with each
implemented interface; Task 7 audits completeness rather than deferring truthful
current documentation. Preserve historical ADR bodies, plans, native failures and
valid Obsidian/Readest/Tauri fixtures. Static inventories, actual host tool calls,
rendered UI and each native OS/architecture need separately identified evidence.
Cross-build/emulation is not native acceptance. No tags, release publication or
repository/user/global configuration changes are authorized by this plan.

## Deferred current-content cleanup for Task 7

The existing CONTRIBUTING.md Agent submission link targets the absent
AGENTS.md#issue-submissions heading. Task 7 must reconcile this stale reference
with its canonical policy owner, currently
[typed Issue submissions](../../docs/policies/commits-and-scope.md#typed-issue-submissions),
while checking the actual surrounding submission obligations. It is a tracked
cleanup item, not a permanent exemption from current-content correctness.
