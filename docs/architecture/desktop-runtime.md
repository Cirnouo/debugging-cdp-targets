# Desktop App runtime

The singleton desktop App composes the [Gateway Core](gateway-core.md), which
owns verified target processes and official Server children. The App owns the
public [MCP HTTP endpoint](../reference/mcp-http.md) and final cleanup. Client
transport detachment leaves App-owned resources and work intact.

The Codex and Claude Code Plugins deliver host metadata, direct HTTP
configuration, artwork, documentation and the shared Skill. They connect to the
already running App at `http://127.0.0.1:27637/mcp` and never launch a gateway.
App and Plugin versions are independent strict SemVer strings. Both host payloads
and the shared Skill share one matching Plugin version.

## Windows applicability

The App and gateway target Windows 11 x64 and arm64 for installer and portable
delivery. Linux and macOS have no support tier. Both Windows architectures
still require native qualification, and default installation admission stays
disabled. [Deployment](deployment.md#building-and-evidence) distinguishes static
checks, contributor staging and pending native acceptance.

## Startup, storage and exit

The small Electron bootstrap first refuses non-Windows operating systems and
unsupported architectures and requests normal Quit, before reading App data,
creating owned scratch, loading native resources or importing asynchronous main
composition. On a supported Windows platform/architecture, it synchronously
captures the native App data base and redirects Chromium userData/sessionData
into separate children of one private per-process OS temporary directory. Only
then does it import main without awaiting its ready-dependent startup from the
entry module. Electron releases ready only after entry import completes. Main
retains its startup promise and early normal-Quit handlers, while bootstrap
observes rejected startup without exposing raw errors. Configuration never uses
this cache. Normal exit tries to remove its own cache. Chromium-held files may
remain in OS temporary storage.

The App verifies its native loading closure before holding a kernel advisory
lock for the actual process lifetime. The lock namespace derives from the native
OS account and is independent of installed/portable configuration. A losing
process sends one fixed activation frame to the first owner and exits. If that
channel cannot activate the owner, the loser displays a native warning before
normal exit. It never creates or migrates selected data. No Electron singleton lock, heartbeat, PID
takeover or force kill participates.

Only the winner creates App data. Installed builds use native App data. Portable
builds use `data` next to the executable.
Neither mode searches for or merges another root. Registrations, targets, jobs
and launch snapshots remain memory-only. Configuration schema 2 stores desired
port, appearance and optional explicit host configuration-root/executable/cache
selections. Existing schema 1 port/appearance documents migrate through a real
validated 1-to-2 step with exact original bytes backed up. Unknown, corrupt, noninteger or future versions refuse
writes. A small sequential migration runner validates every source and
destination. Only a fully successful chain backs up the original bytes and
atomically replaces the file. Production promises no pre-schema-1
legacy migration.

Appearance applies immediately. A port edit changes desired configuration. The
effective port stays fixed until normal restart. A bind conflict keeps the
manager available and never silently chooses another port. The manager uses a fixed local asset protocol, sandbox and context isolation.
It disables Node integration, denies external navigation and permissions, and
checks the sender and main frame for management actions. Its bridge exposes only inspect, configure, closed management commands,
Quit and Restart. A nonbound endpoint is never displayed as effective.

Quit stops new HTTP admission, waits for the entire startup promise, then invokes
the trusted cleanup capability saved before first catalog acquisition. Admitted
atomic configuration writes and all pending native host-management chains also
settle before actual exit. [Core cleanup](gateway-core.md#cleanup-and-runtime-injection) cancels admission, normally closes owned targets, disposes official
children/routers and proves release. Only success closes HTTP/activation and
exits. Startup or cleanup failure keeps ownership and the manager for retry.
Target normal Close has no artificial exit deadline. Host/socket/window
disconnection never requests cleanup. The fixed activation channel has no admin
request or credentials.

## Management and host synchronization

The dashboard shows public registration identities, owners, connections and the
Core's existing lifecycle operation registry. It never reads back bearer tokens
or starts a target. Selected connection details explicitly show launch/official
configuration and directory evidence. The dashboard shows environment override
names without their values. Summaries contain no launch paths or raw native output.
Read status, Wait for change and Cancel expose a selected operation's actual
state, bounded lifecycle result/failure and explicitly acquired-directory cleanup
evidence, including failed starts without a current connection. The last explicit
read stays separate from summary polling and remains owned by the original registration.
Choose target, official Server or both for restart. Each uses the immutable
snapshot from the successful start. Close requests ordinary target shutdown. Per-row/batch Close
and idle transfer retain independent outcomes, including busy and stale rows.
Unregister is available only for registrations without resources or live jobs.

Connection age begins at first successful logical establishment and survives
side restarts. Idle begins at the last real operation, excluding status, wait,
summary polling and GUI refresh. Both display HH:mm:ss with unbounded hours;
missing/invalid evidence displays Unavailable. One local clock interval updates
the view without touching Core activity or invoking host CLIs.

The [Host Plugin management architecture](host-plugin-management.md)
owns native selection, cached host jobs, synchronization checkpoints, receipt
restoration, port retry and reload obligations. The dashboard keeps these outcomes
separate from Core lifecycle operations and waits for actual native completion
before Quit. The supplied user-intent parser, selected-file evidence and native
publication order remain with their Host owners. The dated
[native host management study](../evidence/host-plugin-research.md#native-user-plugin-management-study--2026-10-17)
records executed versions and limits.

Current source tests cover these contracts with real Core/Task5 services and
controlled I/O. React server rendering is component-only evidence. Native
management interaction/visual acceptance and both Windows architectures' installer
and portable delivery remain separate explicit acceptance gates.
