# Desktop App runtime

The App owns the transport-independent core, verified target processes and
official Server children. Codex and Claude Code Plugins contain host metadata,
direct HTTP configuration, artwork, documentation and the shared Skill. They
connect to `http://127.0.0.1:27637/mcp`; they never launch another gateway.
App and Plugin versions are independent strict SemVer strings. Both host payloads
and the shared Skill still have exactly one matching Plugin version.

## Startup, storage and exit

The small Electron bootstrap synchronously captures the native App data base and
redirects Chromium userData/sessionData into separate children of one private
per-process OS temporary directory. Only then does it import asynchronous main
composition without awaiting its ready-dependent startup from the entry module.
Electron releases ready only after entry import completes; main retains its startup
promise and early normal-Quit handlers, while bootstrap observes rejected startup
without exposing raw errors. Configuration never uses this cache. Normal exit tries to remove
its own cache; Chromium-held files may remain in OS temporary storage.

The App verifies its native loading closure before holding a kernel advisory
lock for the actual process lifetime. The lock namespace derives from the native
OS account and is independent of installed/portable configuration. A losing
process sends one fixed activation frame to the first owner and exits. If that
channel cannot activate the owner, the loser displays a native warning before
normal exit. It never
creates or migrates selected data. No Electron singleton lock, heartbeat, PID
takeover or force kill participates.

Only the winner creates App data. Installed builds use native App data; portable
builds use `data` next to the executable (next to the `.app` bundle on macOS).
Neither mode searches for or merges another root. Registrations, targets, jobs
and launch snapshots remain memory-only. Configuration schema 2 stores desired
port, appearance and optional explicit host configuration-root/executable/cache
selections. Existing schema 1 port/appearance documents migrate through a real
validated 1-to-2 step with exact original bytes backed up. Unknown, corrupt, noninteger or future versions refuse
writes rather than resetting. A small sequential migration runner validates
every source and destination; only a fully successful chain backs up original
bytes and atomically replaces the file. Production promises no pre-schema-1
legacy migration.

Appearance applies immediately. A port edit changes desired configuration;
effective port stays fixed until normal restart. A bind conflict keeps the
manager available and never silently chooses another port. The manager uses a
fixed local asset protocol, sandbox, context isolation, no Node integration,
denied external navigation/permissions and sender/main-frame checked management
actions. Its bridge exposes only inspect, configure, closed management commands,
Quit and Restart. A nonbound endpoint is never displayed as effective.

Quit stops new HTTP admission, waits for the entire startup promise, then invokes
the trusted cleanup capability saved before first catalog acquisition. Admitted
atomic configuration writes and all pending native host-management chains also
settle before actual exit. Core
cleanup cancels admission, normally closes owned targets, disposes official
children/routers and proves release. Only success closes HTTP/activation and
exits. Startup or cleanup failure keeps ownership and the manager for retry.
Target normal Close has no artificial exit deadline. Host/socket/window
disconnection never requests cleanup. The fixed activation channel has no admin
request or credentials.

## Management and host synchronization

The dashboard shows public registration identities, owners, connections and the
Core's existing lifecycle operation registry. It never reads back bearer tokens
or starts a target. Selected connection details explicitly show launch/official
configuration and directory evidence; environment override names are shown
without their values. Summaries contain no launch paths or raw native output.
Choose target, official Server or both for restart; each uses the old successful
immutable snapshot. Close requests ordinary target shutdown. Per-row/batch Close
and idle transfer retain independent outcomes, including busy and stale rows.
Unregister is available only for registrations without resources or live jobs.

Connection age begins at first successful logical establishment and survives
side restarts. Idle begins at the last real operation, excluding status, wait,
summary polling and GUI refresh. Both display HH:mm:ss with unbounded hours;
missing/invalid evidence displays Unavailable. One local clock interval updates
the view without touching Core activity or invoking host CLIs.

The App constructs the concrete Codex/Claude Task5 manager, native adapters and
secret-free receipt store only after singleton/data admission. After successful
HTTP bind it independently restores/revalidates each selected host's owned
receipt and synchronizes its URL. Missing published candidates are ordinary in
0.1.0; no feed, polling URL or stable release is invented. A verified owned copy
can synchronize with a null candidate, and a stale compatible candidate never
downgrades it. Disk synchronization remains host reload pending; file readback
does not prove an active host session.

Host summaries preserve missing CLI/plugin, native failures, no candidate,
disabled/pinned/read-only/shared restrictions and partial failure. Inspect host
and Sync / retry explicitly perform native work; ordinary dashboard refreshes
read cached host state. Hosts serialize independently. Explicit absolute
configuration roots and executable selections support different desktop
environments; Claude also supports a cache-root selection. Blank uses the App's
admitted user environment and home as neutral cwd. Selection changes refuse
while that host is busy and create a fresh idle adapter/manager. Receipts from
another root/selection never authorize adoption.

Save a desired port, restart normally through cleanup, bind the new endpoint,
then synchronize eligible hosts independently. A failed bind keeps the manager
available for a port correction and performs no host URL synchronization.
One host's failure does not roll back the other; retry the affected host and
reload it after successful disk synchronization. Quit denies new mutations and
waits for actual native CLI completion as well as normal Core cleanup.

Current source tests cover these contracts with real Core/Task5 services and
controlled I/O. React server rendering is component-only evidence. Native
management interaction/visual acceptance and all six delivery cells remain
separate explicit acceptance gates.

## HTTP and authentication

Public SDK Node Streamable HTTP binds only `127.0.0.1`, checks exact effective-port
Host, fixed `/mcp`, bounded JSON body, methods, content type and Origin. Forwarded
headers confer no authority. Missing, expired or unknown bearers fail before
owned reads or effects. Rejections never include raw requests, tokens or paths.
After authentication, known busy and originating-client facility failures carry
a closed code and fixed actionable explanation. Unknown upstream errors remain
generic; the App never projects arbitrary exception text. A locally known facility
failure stays associated with its owned execution across the official SDK round trip.

The same endpoint serves strict 2026-07-28 requests and sessionful legacy HTTP
through one Server factory and Core. Public SDK classification owns era routing;
invalid modern envelopes, unsupported revisions and header/body disagreements
cannot fall back to legacy. Modern discovery/results/cache metadata are SDK
generated, and modern calls do not create MCP sessions. Legacy initialization,
GET/DELETE, session IDs and negotiated facilities remain supported. The outward
official/lifecycle catalog remains fixed and does not advertise list changes.

`dct_registration_register` returns public registrationId and private
registrationBearer once. Every other lifecycle tool explicitly supplies that
bearer. Each official call carries `{registrationBearer, connectionId, sessionId}`
inside `_dct`; the whole route is removed before original arguments reach the
official Server. Correct bearer possession can reconnect through another MCP
session. Sessions hold no implicit current registration. Authorization headers
and chat/session identifiers do not substitute for the bearer.

## Request lifetime

Each call builds its own original facilities for roots, elicitation and progress.
Modern capabilities belong to the current request envelope. A modern start
collects advertised roots with SDK `input_required` before acceptance or resource
acquisition, then retains that immutable snapshot for its asynchronous job.
Unsupported roots produce an empty snapshot. Legacy accepted starts may return
operationId while original roots admission is pending; normal response completion
does not replace those facilities. A real original client/session disconnect
makes them unavailable without closing App-owned targets.

Modern form input continues the same invocation across response exchanges.
Signed process-local state binds principal, route, arguments and the unconsumed
round; accepted content is validated against the pending schema. One input flow
has at most eight distinct forms and a fixed 600-second deadline beginning at its
first form. Normal intermediate Server close preserves that invocation. Actual
cancellation/disconnection or abandoned-input expiry removes its protocol holder
and detaches facilities while Core retains actual execution accounting. There is
no completed official-result archive or automatic replay.

Progress uses only the active originating response and its defined current token,
including numeric zero. A continuation can change its token. Intermediate/terminal
completion and detach stop that channel; neither a peer nor a listen stream can
receive it. Keep the operation wait/status/result path independently of optional
progress. No MCP Tasks requirement, connection-state Resource or automatic chat
question chain is added. [ADR 0018](adr/0018-mcp-protocol-compatibility.md) owns the
protocol decision and [host metadata](host-metadata.md#mcp-protocol-compatibility-research--2026-10-17)
separates fixed-version host source evidence from actual wire acceptance.

Explicit cancel promptly ends local admission and its SDK wait; cleanup likewise
terminates admission and retains accurate cancelled/failed state. Late roots
responses are consumed with zero new directory, router, target or official
acquisitions. A detached official response wait retains its execution slot until
the actual response or definitive upstream close. It does not replay, restart or
quarantine a healthy upstream.

Public SDK 2.2.0 has a wire limit: cancellation notifications retain the original
relatedRequestId, while Node HTTP removes that response's stream mapping after
the accepted response ends. Cancellation over that ended SSE is best-effort and
cannot promise abortion of the remote roots handler. Local termination and zero
late effects remain required. Actual SDK HTTP tests cover this trace; InMemory
tests cover reachable wire abortion. The pinned SDK protocol cancellation and
Node transport send/stream mapping are the source of this limitation. No private
SDK patch or replacement legacy request context is used. Modern input uses the
public standard MRTR facilities described above.

## Actual official catalogs

Each real official generation publishes complete reviewed actual-tool snapshots.
Advertised `tools.listChanged` enables a native SDK callback and one serialized
uncapped page walk; notification bursts coalesce, and stale owners cannot publish.
Complete Tool definitions, including output schema, must match reviewed variants.
The fixed outward `tools/list` remains unchanged. Selected tool details expose
`toolCatalog: {revision, state}`; selected configuration includes it under
`official.toolCatalog`. State is `current`, `refreshing` or `unavailable`.

Refresh failure retains last-known schemas marked unavailable and blocks new
official forwarding with `OFFICIAL_CATALOG_UNAVAILABLE`. A later notification or
call admission can validate a coalesced refresh and recover without restart or
replay. Running calls and healthy resources remain alive. Each actual call
captures its accepted Tool definition for its entire SDK output validation.
Capability-free upstreams retain startup catalog knowledge without claiming
notification support; fixture notifications do not prove the delivered official
release emits live changes for its fixed startup configuration.

## Building and evidence

Complete the trusted installation sequence first. App build checks reviewed
Electron/ordinary Node archives, the unchanged complete official npm release and
original native loader files, then collects licenses from actual esbuild inputs
and reviewed SDK vendor maps. Catalog and every connection receive the same
verified ordinary Node executable and original public bin. Electron never acts
as their Node runtime. None of those files is installed through the Plugins.

`pnpm check:app` checks bundles, license evidence, original native closure and
official bytes without writing a stage. For a local Windows stage, provide
archives matching `tooling/app-release-inputs.json`:

```powershell
pnpm build:app --portable --electron-archive <electron-zip> --node-archive <node-zip> --output <new-absolute-stage-directory>
```

The destination must not exist; same-version content is never overwritten.
Launch its `electron.exe`. This is a local development stage, not an installer
or publication. Windows x64 extraction/native-loader execution has been exercised;
other recorded archive identities do not establish native acceptance. Signed
installers, complete immutable version retention and managed uninstall remain
separate deployment work. No background update service or rollback/pruning
mechanism is introduced.

Owned App/research bundles explicitly disable ws optional `bufferutil` and
`utf-8-validate` loading through its supported compile-time opt-out switches.
WebSocket masking uses the bundled JavaScript implementation; Node 24's built-in
UTF-8 validation remains available. Optional native masking could be faster;
this delivery makes no performance claim or implicit addon acquisition. Emitted
imports must belong to Node builtins or the exact selected Electron/native App
closure. The unchanged original official release is delivered independently.

Test-only `tests/fixtures/http-gateway.ts` composes real Core and SDK HTTP and
refuses native start/restart without `--allow-gui`. `native-fixture-seal.ts`
binds that fixture, both complete screenshot study subjects, original native
helpers and a complete App stage to actual source inputs/digest and independent
whole-file inventories. Study source launchers only verify and start the sealed
ordinary Node; measured code verifies itself before native acquisition. The pure
verification module imports no builder or esbuild runtime. Execution uses only
this sealed closure.
Dirty development seals cannot establish final acceptance; final native evidence
requires a clean committed revision and fresh seal. Fixture cleanup/actual child
exit, actual App GUI/singleton/exit, native target behavior, host HTTP execution,
installed metadata and host-rendered icons are distinct acceptance surfaces.
