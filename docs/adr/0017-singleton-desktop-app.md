# 0017 — Singleton desktop App and independent host plugins

Status: accepted, 2026-10-17. Both App and plugins remain 0.1.0 Unreleased.
The shared core and minimal App/direct HTTP/thin-plugin cutover are implemented
in source; richer management, native deployment and all six distribution cells
remain separate acceptance work. [App runtime](../app-runtime.md) documents the
current boundary and evidence limits. This decision and the
[implementation plan](../../.superpowers/plans/2026-10-17-singleton-app-plan.md)
govern the remaining work; historical decisions below retain their design context.

## Decision and supersession

A consciously launched Electron desktop App owns the gateway core, native target
resources, complete unchanged official Server package and separately bundled
ordinary Node 24. React/TypeScript management UI uses a narrow preload interface;
the renderer has no general filesystem, shell, process or unrestricted IPC power.
Maintained Node code remains native erasable TypeScript. Do not mechanically
relocate source or create empty packages merely to express ownership.

The App is GUI-only: no TUI, CLI/headless mode, per-chat proxy, service, autostart,
deep links, restored runtime objects or cross-platform parent-death supervisor.
Official Server children still use the official SDK's stdio transport; forwarding
preserves official names, arguments and results after stripping required _dct
connection/session routing. No custom DevTools tools or fixed connection limit.

This scoped forward supersession preserves the historical ADR bodies:

- 0007/0008: replace per-entry stdio ownership with one App and client contexts;
    preserve independently routed verified target/official pairs and fresh identity.
- 0009: remove task activity, host Hooks, injected notices and Stop continuations;
    retain reliable native actual-exit observation, explicit Close/Keep and no
    force-kill. 0015 already superseded its fixed profile policy.
- 0010: move complete original npm release delivery from each plugin to the App.
    Preserve independent canonical tarball/file evidence, full unchanged bytes,
    licenses/notices/vendor inventory, runtime verification and original public bin.
- 0011: replace outer stdio entry, seven-tool/end-task/public entryId, mutable
    restart configuration and client-abandonment quarantine. Preserve MCP operations,
    native launch/elevation/identity, reviewed fixed official catalog, request
    idempotency, no replay and independent upstreams. Narrow GUI preload and bounded
    singleton activation are the only new internal IPC allowances.
- 0012: retain independently audited host-native peer payloads, exact inventories,
    shared Skill/source equality and host research; remove duplicated runtime,
    official package, native helpers and physical/default Hook trees at cutover.
- 0013: registration/App ownership replaces transport/session-driven cleanup and
    task notices. Retain ownership before acquisition, actual-exit evidence,
    disposal barriers/retry evidence and normal actual-app shutdown.
- 0015: preserve explicit none/data-dir intent, researched application binding,
    conservative occupancy gate, canonical overlapping-directory claims,
    connection-level leases, preauthorized whole-directory cleanup and explicit
    path evidence. Replace only Keep/end-task and disconnect assumptions; an
    intermediate restart exit or client close cannot release an owned lease.

ADR 0006's layer/type boundaries, 0014's applicable screenshot composition and
0016's contributor toolchain remain. Current source rules move with implementation;
the installed Skill and user guides must never present this acceptance as delivery.

## Singleton, data and launch

One App singleton exists per OS user across installed/portable copies and all data
roots. Installer data is per-user; portable data is extracted-local (beside .app
on macOS). First process owns its chosen data. Later processes activate it without
migration/merging or configuration writes. Tray/menu bar is default, with a
management-window fallback on systems lacking it.

Use a native OS advisory file lease, held until final process exit. Never unlink
its file, expire it by heartbeat, steal ownership or force down an unresponsive
owner. Electron requestSingleInstanceLock is not the actual guard because the
inspected [Chromium 152 POSIX implementation](https://github.com/chromium/chromium/blob/152.0.7977.167/chrome/browser/process_singleton_posix.cc)
can kill an unresponsive owner; the [Electron 44.8.0 patch](https://github.com/electron/electron/blob/v44.8.0/patches/chromium/process_singleton.patch)
does not remove that path. A single
bounded activation-only local pipe/socket is permitted, without administrative or
data commands; only the lease winner manages stale activation sockets. A loser
activates the winner or visibly reports an unresponsive existing owner. The
candidate [fs-native-extensions 1.5.1](https://registry.npmjs.org/fs-native-extensions/1.5.1)
needs complete supply-chain review and six
native Electron load/lock tests before adoption; this ADR adds no dependency.

Persist configuration only, with integer schemaVersion and pure sequential
migrations. Acquire the singleton before migration; validate each step, back up
and atomically commit the entire chain. Corrupt/future schema refuses writes.
Never persist live sessions, jobs, ownership bearers or restore targets. Cheap
settings apply hot; expensive settings and port are cold. Show desired/effective
state. Saving a desired port does not establish successful binding.

## Direct HTTP and registration ownership

The default endpoint is http://127.0.0.1:27637/mcp using direct Streamable HTTP.
Bind loopback only, enforce Host/Origin boundaries and fail explicitly on port
conflict. No long-term HTTP API key, stdio proxy or external control service.
Each client has its own SDK request context, roots, progress and elicitation.
There is no global current caller or implicit current connection.

A registration bearer owns connections and lifecycle jobs independently of chats,
sockets and MCP sessions. Prefer verified initialization registration when possible,
with ordinary register-tool fallback. Validate expiry before activity refresh;
successful authenticated calls, including status, refresh activity. Registrations
without resources/nonterminal work expire after 30 idle minutes; their terminal
history expires with them. Reconnect does not replay start, revoke or transfer.
There is no token readback/recovery. New registration plus GUI transfer of idle
resources provides recovery. A different bearer cannot use/read/cancel/transfer
owned resources or another owner's terminal operation/results.

Only newly launched, independently verified targets are managed, one target and
one independent official Server per connection. Agent authority is bearer-scoped;
GUI administers all. Transfer refuses busy connections, transfers future operation
and roots ownership, and preserves the original owner of old terminal results.
Keep leaves ownership intact without taskActive or end-task behavior. Close/Keep
remains an explicit user decision without a default.

Drop public entryId, taskActive, end-task, hookEventName/Hook output and notification
injection atomically with HTTP/host changes in Task 4. Keep connectionId stable
across restart and issue a fresh sessionId after any side restart; requestId and
operationId remain distinct. Reject stale, unknown and inapplicable fields.

## Execution, restart and cleanup

Admit one actual official execution per connection; overlapping calls report busy,
while independent connections proceed in parallel. Client cancellation or HTTP
timeout detaches only its wait. Keep the healthy target/upstream and busy admission
until actual execution settles; retain only bounded in-flight state, not a second
public operation/result archive. Lifecycle jobs retain operationId/status/wait/cancel.
Progress/elicitation use the originating context and explain unavailable context;
never reroute to another client. Never automatically replay an official call.

Snapshot initiating roots before acquiring resources (empty if unsupported), and
retain explicit workspace/default temporary-directory behavior. Successful launch
creates an immutable snapshot of executable/args/cwd/resolved environment, official
configuration and connection roots. Later roots/default changes cannot rewrite it.
Restart accepts explicit target/official/both scope and only that old snapshot.
Changed executable/args/cwd/env/MCP config requires completed Close/new start.
Explicit target ports remain fixed; automatic ports may change behind a stable
router URL. Target-only restart retains official Server identity and requires
public-bin reconnect/cache-invalidation evidence. No rollback retry chains.

Register expected exits before exit using operation/PID/generation so callbacks
cannot delete a successor. A real unexpected target exit ends the connection and
cleans official resources, without target restart or a Hook question chain.
A diagnosable single-subject failure may repair that side while preserving its
healthy peer; failed repair cleans and reports. No pair retry/escalation engine.
Both restart, Close and App exit clean both sides. Reliable actual PID/time/handle,
listener/endpoint identity and authorization waiting remain separate requirements.
Applications are never force-killed; native helpers are not the actual app.

Normal App exit succeeds only after required cleanup succeeds. Failure retains
management UI, resource ownership and evidence, denies new work while closing and
allows cleanup retry; never claim successful exit or discard a live/pending app.
Directory leases survive late acquisition/permission waits, successor creation,
scoped restart, transfer and disposal failures until every live/pending app and
read/write user releases them. Verify identity before whole-directory deletion;
child links cannot widen scope. Path evidence stays in explicit operation/selected
configuration metadata, never default summaries. Keep existing native isolation
and cleanup regressions and valid application fixtures.

## Management and host synchronization

GUI views registrations/connections/operations and supports scoped restart, Close,
batch Close/idle transfer and unregistering empty registrations. It never creates
a target from scratch. Age starts at first successful logical establishment;
last-real-operation excludes polling/status/wait/UI refresh. Display HH:MM:SS with
unbounded hours. Port workflow saves desired value, normally restarts/cleans the
App, binds the new port successfully, then independently syncs each user-level
host plugin. Report success/failure/reload-pending and retry per host, without
rolling back a successful host because another fails.

Each concrete native CLI adapter re-resolves actual returned installation paths
after updates, patches/reads back only its own MCP URL, supports explicit host
configuration roots and preserves source/ref/pin/disabled intent. Project/local/
managed copies are read-only. A user installedPath shared with unmanaged records
is a visible conflict. Claude readFromFolder remains local/read-only even with a
cache installPath. Codex add enables and only its result supplies installedPath;
unknown existing paths remain read-only absent a safe native path-establishing
operation. Codex upgrade must name only this marketplace, whose whole-catalog
refresh is refused if unrelated, disabled/pinned or shared/unmanaged entries could
be touched. Independently research host contracts before implementation.

## Independent versions and publication

Root package.json.version owns the strict SemVer App version. Shared maintained
Skill metadata owns one strict SemVer plugin version; both maintained and generated
host manifests must match it. App version may differ. Existing build, repository,
distribution and release consumers validate these groups, preserving duplicate-key,
license, exact source/output, tag identity, main ancestry and permission checks.
No empty App package, duplicate registry or unused version parser is needed.

The future schema-versioned static latest-plugin record contains one latest stable
plugin version, minimumAppVersion, and immutable git-subdir payload source identity
(lowercase 40-character commit SHA) with verifiable integrity for both host payloads.
Keep configured marketplace main/ref. Payload commit A precedes separately
authorized catalog/feed commit B; both entries and latest record pin A. Precheck
record/catalog/source/compatibility before mutation, postcheck actual path/bytes/
version/pin before URL patch. External source movement may cause visible partial
failure. The selected source form follows the independently inspected
[Codex 0.163 parser](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core-plugins/src/marketplace.rs#L1044)
and [Claude git-subdir contract](https://code.claude.com/docs/en/plugins/marketplace-reference#git-subdir-plugin-source);
recheck and record current metadata evidence with the Task 5 consumer.
No private staging marketplace, adoption framework, remove/re-add,
compatibility history solver, backend or automatic downgrade.

Compatible published stable plugins update independently of App Releases; an
incompatible latest retains installed plugin and requests App update. Missing record
is ordinary unavailable-update state. No stable feed/record, digest, release URL or
poll target is advertised while 0.1.0 remains Unreleased. This decision creates no
publisher, tags, feed or publication authorization. Existing source-only release
workflow is not evidence of native App delivery.

## Delivery and implementation gates

### Accepted live deployment amendment — 2026-10-17

This forward amendment adds live installation/update and installation-bound
managed uninstall. It does not describe current installer or GUI support.
Complete immutable, content-identified builds retain every Electron, ordinary
Node, official Server, native-loader and lazy resource byte. One atomic selection
record chooses the next launch; an existing App pins its admitted build for its
whole lifetime. Updating the selection never changes a live App's files, data,
listener or children. Same-SemVer builds have distinct content identities. No
rollback solver, automatic pruning, background App updater or service is added.

Exactly two persistent installation lock inodes survive managed uninstall:
exclusive operation ownership serializes writers, while shared live-use ownership
excludes exclusive deletion. These are separate from the OS-user singleton.
Never unlink/recreate, expire, upgrade or take over a lease. Every admitted App
and pending restart launch remains covered until actual exit or an overlapping
successor-held shared lease is acknowledged. The original audited public native
lock API supplies shared/exclusive modes; Linux uses its OFD lock family, rather
than a shell flock substitute. Actual ownership/permissions must authorize each
role; a metadata field is not permission evidence.

Installation metadata records configuration, physical root identity and a complete
build selection, never persisted runtime sessions or registration credentials.
Copied/moved portable directories require explicit enrollment validation in the
delivery layer; startup must not adopt, rewrite or repair identities. Strict
schema-versioned active/removing/removed fences refuse future, malformed, stale
or foreign identities. A pre-commit failure retains the previous selection; an
uncertain outcome after atomic replacement is an indeterminate commit. Keep the
fence and payloads rather than guessing success, restoring or replaying work.
Complete payload verification must precede selection; formatted build/manifest
hashes alone do not prove the payload is complete or trusted.

The supplied removal flow requests normal cleanup only from the matching
installation and current account through one closed private activation frame.
It requires cleanup and actual exit plus exclusive installation use before
deleting owned binaries. Failure, uncertainty or another user's reader refuses
deletion. Preserve user data/plugins and the coordination tombstone. Manual
Trash/rm, forced package/file overrides and overlaying a live portable directory
remain outside supplied callbacks. Native NSIS needs a custom non-overwriting
sequence, DEB retains complete runtime outside dpkg's replaced payload file list,
and DMG uses an explicit install/update GUI action; default builder replacement
does not establish this contract.

Normal restart uses one short, verified, copied ordinary-Node bridge outside the
installation. Both launches have detached lifetime. Exact parent exit precedes
successor launch, with overlapping use leases. One private atomic temporary
receipt, at most 512 bytes and bound to attempt nonce, actual child PID,
installation and build, acknowledges the successor's independently acquired use
lease. A valid ACK lets the bridge exit promptly. An unacknowledged live or
uncertain child retains observation and coverage without kill, replay or
timeout-as-exit. No GUI fd-3 assumption or resident cleanup driver is introduced;
unverifiable actual-exit-safe helper cleanup leaves owned temporary residue.
Synchronous Chromium userData/sessionData isolation remains startup step zero,
before any await, native verification or installation lease. Chosen configuration
migration remains after singleton ownership.

Task 7 is split into independently reviewable increments: 7a implements strict
pure metadata/transitions, the existing native shared/exclusive seam and a bounded
atomic state store; 7b integrates pinned startup, normal quit and restart handoff;
7c delivers actual packaging/installer GUI and native acceptance on all six cells.
7a accepts only already enrolled roots, stages/removes no payload, and does not
enable deployment in current App startup. Missing native Windows ACL evidence,
macOS permission/local-filesystem evidence and system-DEB role validation block
those store/lease inputs. These are hard prerequisites before 7b enables admission
on those platforms; existing App startup retains its current platform behavior.
Raw native lock tests in owned temporary fixtures do not establish installed
permissions or Electron/installer support. Six native
OS/architecture cells, both installer and portable families, remain mandatory;
source inspection, unit tests and cross-builds are not native acceptance.

App distributions own ordinary supported Node, full official release, native
helpers, licenses/notices and verifiable integrities. Thin host-native plugins
contain manifests/Skill/assets without runtime, official bytes or host Hooks.
Six OS/architecture installer and portable targets cover Windows 11, macOS 15 and
Ubuntu 24.04, x64/arm64. Cross-build/emulation is not native acceptance.

Task 2 implements governance/version contracts and this forward documentation only.
Tasks 3–7 implement core, atomic App/HTTP/Hook cutover, host updater, management and
native delivery. Task 4 includes current Skill/protocol/init instructions, exact
inventories, actual dual-host tool smoke and App-owned Node/official delivery.
Update audits/security fingerprints/type/syntax/CI gates narrowly with actual new
surfaces; do not broadly exempt Electron/IPC or relax installation scripts/trust.
Default regressions acquire no user targets/downloads or implicit GUI permission.
Task 7 separately verifies every native architecture, UI claim and actual host call,
and semantically reconciles current bilingual docs while preserving dated history.
No tags, publication, user/global configuration or repository settings are authorized.
