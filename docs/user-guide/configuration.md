# Launch and MCP configuration

The Agent normally follows the shared Skill. These settings explain how the
Plugin launches a target and configures its official Server connection. Use
[workflow](workflow.md) for the task sequence and the
[lifecycle protocol](../lifecycle-protocol.md) for exact selectors and delivery rules.

## Lifecycle tools

The Plugin manages targets directly through MCP:

| Tool | Behavior |
| --- | --- |
| `dct_connection_status` | Discovery, connection/operation status, tool requirements and automatic Hooks. |
| `dct_connection_start` | Accept a structured new launch with explicit isolation and return an operation immediately. |
| `dct_connection_restart` | Explicitly replace a live session, optionally with new mcpArgs. |
| `dct_connection_stop` | Apply the user's Close/Keep choice to one session. |
| `dct_connection_end_task` | End work and retain a live target/upstream. |
| `dct_operation_wait` | Wait for operation events/results using a replay cursor. |
| `dct_operation_cancel` | Cancel the selected operation and report actual cleanup. |

Except initial empty status discovery and automatic Hooks, requests identify
entryId. Restart, end-task and stop also require connectionId and sessionId;
start accepts neither. Status and start forbid sessionId; only stop takes
disposition. The [protocol](../lifecycle-protocol.md#requests-and-status-selectors)
defines the allowed status combinations and exact identity requirements.

## Structured application launch

Every start requires structured application settings and an explicit isolation
object. Resolve the actual executable and any required cwd/env from applicable
supplied authorization or read-only installation/startup evidence for this request;
an independent request or example does not establish those values.
Do not submit a concrete start while a required value remains unresolved.

```typescript
type Isolation =
    | { mode: 'none' }
    | {
        mode: 'data-dir';
        directory:
            | { kind: 'existing'; path: string }
            | { kind: 'new'; parent: string; name?: string };
        cleanup: 'retain' | 'delete-on-release';
    };
```

Existing path and new parent are absolute. Existing must already be a directory;
new requires an existing parent and exclusively creates one named leaf, or a
random `dct-` child when name is omitted. Missing existing paths, missing parents,
named collisions and equal/ancestor/descendant real-directory claims fail without
fallback. The program owns acquisition and cleanup; do not precreate the leaf.

After verifying the application's isolation/CDP contract and selecting this
parent and retain policy, a Chrome start can use:

```json
{
    "entryId": "<entry-uuid>",
    "requestId": "chrome-start-1",
    "targetKind": "chrome",
    "isolation": {
        "mode": "data-dir",
        "directory": { "kind": "new", "parent": "C:/Work" },
        "cleanup": "retain"
    },
    "launch": {
        "executable": "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "args": ["--remote-debugging-port={port}", "--user-data-dir={dataDir}"],
        "cwd": "C:/Work",
        "env": {}
    },
    "mcpArgs": ["--workspace", "C:/Work"]
}
```

Data-dir requires researched `{dataDir}` binding in args or env values; none
forbids the placeholder and acquires/deletes no isolation directory. Executable,
cwd and environment keys cannot bind `{dataDir}`. The acquired real path is
inserted opaquely after ordinary expansion; its bytes are not expanded again as
environment variables, `{port}` or another `{dataDir}`. A binding proves the
passed directory, not complete isolation of state or production effects.
For isolated Chrome, the effective canonical `--user-data-dir={dataDir}` must
match the acquired real directory. Only the equals-form switch before exact `--`
is accepted; duplicate, separate-value and native alias forms fail.

`{port}` works in application args/env. `%NAME%` and `${NAME}` expand within
structured fields. No shell parsing or command-string interface is involved.
Without a placeholder or explicit debugging port, the Plugin appends the
Chromium debugging-port argument. Other CDP runtimes use their documented
args/env; a framework name alone does not prove compatibility.

Windows launch is a Plugin capability: maintained native helpers inspect
manifests and compatibility settings, preserve argv/cwd/environment across
ordinary or elevated creation, and observe the actual app PID, creation time
and process handle. Windows policy determines whether authorization appears.
Permission waiting does not consume the subsequent CDP readiness budget. Normal
closing uses a one-shot elevated helper when required. Agents need no startup
wrapper or privilege script.

See [operations and waiting](workflow.md#operations-and-waiting) for the returned
operation and cancellation behavior.

## Ports and data directories

Port selection starts at 9222; start's optional basePort selects another range.
Each session reserves a candidate port before probing, preventing concurrent
launches in the same gateway from selecting it. Occupied, privileged and
OS-reserved ports are skipped. A collision after app creation fails clearly and
does not trigger automatic relaunch. Explicit live restart refuses an occupied
original port.

Chrome receives no implicit profile directory. Directory choices are presented
as Agent chooses a suitable location, Chrome preset (Chrome only), user existing,
then user new parent plus optional name. The explicit preset is
`%USERPROFILE%/.cache/chrome-devtools-mcp/chrome-profile` on Windows and
`~/.cache/chrome-devtools-mcp/chrome-profile` on Linux/macOS, resolved to the actual
absolute home location. None never selects or prepares it.

A present preset leaf maps to existing/path; an absent leaf maps to new with
its absolute `chrome-devtools-mcp` parent and name `chrome-profile`.
After explicit preset and cleanup selection, Agent may create only absent
`.cache` and `chrome-devtools-mcp` container ancestors, then verify the parent.
The program alone creates the exclusive leaf. Ancestor files/access or identity
failures/leaf races stop the selection without overwrite or fallback.
Containers remain after leaf cleanup. Generic selections still require an
existing parent and receive no automatic parent preparation.

A user-selected existing nonempty directory, including the preset, retains by
default only when no cleanup choice exists; inform its actual absolute path
without another cleanup question. All other isolated cases need an explicit
retain/delete choice before launch. An existing choice is reused; deletion
covers the entire actual directory, including pre-existing contents.
Root links/junctions resolve to the actual directory; child links do not widen
the deletion scope. The connection lease spans restart and release waits for
actual-exit/native-acquisition/successor/resource settlement.
See [storage and cleanup](privacy.md#data-directory-storage-and-cleanup).

The common read-only occupancy gate applies before every start in both modes.
Known same-directory/shared-namespace use, uncertain attribution of a related
running app and incomplete inspection leave the application unlaunched.
Complete related-app absence can clear a generic point-in-time occupancy gate,
subject to applicable known locks, without a guessed normal root.
New-directory uniqueness or multi-instance capability does not clear the gate.
Generic occupancy is performed by Agent workflow; runtime Chrome checks enforce
known explicit roots and native occupancy. Runtime does not independently resolve
omitted Chrome defaults across branding/channel, policy and launch environment.
Where verified equivalent, none can explicitly bind the SAME normal Chrome root
through existing args without an isolation lease; exact omitted-default argv
remains as requested and needs Agent's known-root occupancy check.
An argv match alone does not prove the effective root against policy overrides.

Regular Chrome 136+ ignores remote-debugging port/pipe for its default production
directory, even when free; that combination remains unlaunched rather than
silently selecting isolation. Chrome for Testing retains the earlier behavior;
other brands/application versions need applicable evidence. See
[Chrome's remote-debugging change](https://developer.chrome.com/blog/remote-debugging-port).

The Chrome launch rules add `--no-first-run`, `--no-default-browser-check` and
`--disable-updater-scheduler` to this launched process only, preserving explicit
switches. It does not modify updater services.

## Windows Chrome screenshot feature

On Windows, `targetKind: "chrome"` also requires the bare Chromium application
feature `CDPScreenshotNewSurface`. Supply the ordinary structured Chrome launch;
the Plugin adds the feature automatically. It inserts one canonical
`--enable-features=CDPScreenshotNewSurface` before the first exact `--`, appends
the bare name to one existing canonical enable list, or keeps one existing bare
occurrence. It preserves other valid ASCII list entries and parameter bytes,
unrelated Unicode arguments and positional arguments after that boundary.

The fixed rule rejects an effective target disable, repeated or noncanonical
feature switches, separate-value forms, a repeated/decorated target entry,
non-ASCII feature values and malformed enable entries. For example,
`Other:one/two:three/four` cannot receive an appended target because its repeated
colon invalidates the complete enable list. Whitespace-padded effective `--`
and Windows `single-argument` forms also fail. See
[ADR 0014](../adr/0014-windows-chrome-screenshot-surface.md#feature-input-contract)
for exact parsing boundaries and the deliberately strict conflict policy.

A conflict fails before data directory acquisition or application spawn and
releases the transient port claim. Port selection/probing may already have occurred.
Repair the reported list or conflicting choice explicitly; the Plugin does not
delete a disable or rewrite ambiguous arguments. Only valid ASCII feature names
and parameter values are accepted. Other launch-field environment expansion
continues to apply as described above.

Composition copies caller arguments and is idempotent. Explicit live restart
reuses the exact composed argv, profile and port. To change application args,
complete normal Close and issue a new start with a fresh requestId and the new
application args. Then use the returned connection/session identities and obtain
fresh page IDs with `list_pages`. `generic-cdp` and Chrome on other platforms keep
their existing launch semantics; this feature is not an MCP/CDP request option.

Normal user window switching and minimizing require no screenshot foreground
checklist or implicit window manipulation. The
[dated Windows Chrome comparison](../mcp-native-validation.md#controlled-chrome-window-state-follow-up-2026-10-07)
records measured static states and their limits. Official screenshot arguments,
routing, timeout quarantine and explicit recovery retain their existing behavior.

## Official Server settings

Each connection has its own `mcpArgs: string[]`, separate from application
args/env. The gateway reserves endpoint/browser-launch options and rejects
configuration files or CLI mode overrides. Configuration changes require
explicit live restart; changing application launch arguments requires normal
Close followed by a new start.

Server defaults enable extensions and disable usage statistics/CrUX.
Per-connection mcpArgs can override them. Gateway environment defaults
`DCT_EXTENSIONS`, `DCT_USAGE_STATISTICS` and `DCT_PERFORMANCE_CRUX` accept
`true`/`false`.

## Official tool availability

The gateway advertises a fixed full official catalog because Codex does not
refresh ordinary local MCP tools from list-changed notifications. Discovery and
lifecycle successes return connection summaries. Selected status adds
enabledTools names and upstreamStatus (`connected`, `disconnected` or
`quarantined`). Explicit toolNames requests return configuration requirements
and exact input schemas only when an actual upstream is valid.

Supported explicitly disabled tools and `TOOL_NOT_ENABLED` provide complete
replacement suggestedMcpArgs; enabled tools have no recipe, and unsupported
tools provide their reason. An unavailable upstream supplies requirements
without asserting actual schemas or enablement. `TOOL_NOT_ENABLED` never
enables a feature or restarts a target.

For example, `click_at` additionally needs `--experimentalVision=true`;
`--slim` limits actual connection tools without shrinking the global catalog.
PWA tools require an official pipe-launched browser and are marked unsupported
for managed CDP connections. Extension tools require
[compatible Chrome](compatibility.md#chrome-extension-tools).

Official calls carry `_dct: { connectionId, sessionId }`. Only that field is
removed before forwarding original arguments; official names, execution and
results stay unchanged. Restart preserves connectionId and the original port
but creates a new session. Obtain fresh page IDs with `list_pages`.

## Workspace access and diagnostics

Use official `--workspace` for file access. Selected status with
`include: ["configuration"]` exposes mcpArgs, isolation evidence and workspace
sources: explicit directories, the system temporary-directory default and negotiated roots
forwarding. cwd does not grant file access. Negotiation alone does not prove
which roots a host supplied.

Explicit operation status for the original start and selected configuration
carry flat isolation evidence: `{mode:'none'}` or
`{mode:'data-dir', path, cleanup, state, nonempty?}`. Path is the actual real
absolute directory; state is held, retained, deleted or cleanup-failed.
Original start evidence remains available after failed/cancelled startup and
route removal; selected configuration is available while its connection exists.
Later cleanup updates original start metadata, not its terminal
state/result/error/cursor or completion notice. Defaults/Hooks omit this evidence
and raw filesystem errors; read it explicitly before claiming cleanup.

Request `include: ["diagnostics"]` only when bounded phase/outcome evidence is
needed. Includes require connectionId and can combine with toolNames;
operationId excludes those selectors. hookEventName is the sole argument
reserved for automatic Hooks. See the
[lifecycle protocol](../lifecycle-protocol.md#requests-and-status-selectors)
for complete selector rules.

For recovery, read [troubleshooting](troubleshooting.md), or return to the
[user guide](README.md).
