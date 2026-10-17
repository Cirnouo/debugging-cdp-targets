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
process sends one fixed activation frame to the first owner and exits. It never
creates or migrates selected data. No Electron singleton lock, heartbeat, PID
takeover or force kill participates.

Only the winner creates App data. Installed builds use native App data; portable
builds use `data` next to the executable (next to the `.app` bundle on macOS).
Neither mode searches for or merges another root. Registrations, targets, jobs
and launch snapshots remain memory-only. Configuration schema 1 stores desired
port and appearance. Unknown, corrupt, noninteger or future versions refuse
writes rather than resetting. A small sequential migration runner validates
every source and destination; only a fully successful chain backs up original
bytes and atomically replaces the file. Production promises no pre-schema-1
legacy migration.

Appearance applies immediately. A port edit changes desired configuration;
effective port stays fixed until normal restart. A bind conflict keeps the
manager available and never silently chooses another port. The manager uses a
fixed local asset protocol, sandbox, context isolation, no Node integration,
denied external navigation/permissions and sender/main-frame checked management
actions. Its bridge exposes only inspect, configure, Quit and Restart.

Quit stops new HTTP admission, waits for the entire startup promise, then invokes
the trusted cleanup capability saved before first catalog acquisition. Core
cleanup cancels admission, normally closes owned targets, disposes official
children/routers and proves release. Only success closes HTTP/activation and
exits. Startup or cleanup failure keeps ownership and the manager for retry.
Target normal Close has no artificial exit deadline. Host/socket/window
disconnection never requests cleanup. The fixed activation channel has no admin
request or credentials.

## HTTP and authentication

Public SDK Node Streamable HTTP binds only `127.0.0.1`, checks exact effective-port
Host, fixed `/mcp`, bounded JSON body, methods, content type and Origin. Forwarded
headers confer no authority. Missing, expired or unknown bearers fail before
owned reads or effects. Rejections never include raw requests, tokens or paths.

`dct_registration_register` returns public registrationId and private
registrationBearer once. Every other lifecycle tool explicitly supplies that
bearer. Each official call carries `{registrationBearer, connectionId, sessionId}`
inside `_dct`; the whole route is removed before original arguments reach the
official Server. Correct bearer possession can reconnect through another MCP
session. Sessions hold no implicit current registration. Authorization headers
and chat/session identifiers do not substitute for the bearer.

## Request lifetime

Each call builds its own original facilities for roots, elicitation and progress.
An accepted start may return operationId while roots admission is pending.
Returning that response does not detach its client or replace original roots.
A real original client/session disconnect makes those facilities unavailable,
without closing App-owned targets.

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
SDK patch, replacement request context or new resumption protocol is used.

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

Test-only `tests/fixtures/http-gateway.ts` composes real Core and SDK HTTP and
refuses native start/restart without `--allow-gui`. `native-fixture-seal.ts`
binds that fixture and a complete App stage to actual source inputs/digest and
independent whole-file inventories. Execution uses only this sealed closure.
Dirty development seals cannot establish final acceptance; final native evidence
requires a clean committed revision and fresh seal. Fixture cleanup/actual child
exit, actual App GUI/singleton/exit, native target behavior, host HTTP execution,
installed metadata and host-rendered icons are distinct acceptance surfaces.
