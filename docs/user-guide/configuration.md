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
| `dct_connection_start` | Accept a structured new launch and return an operation immediately. |
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

Call `dct_connection_start` with structured application settings, adapting the
executable and working directory to the actual installation:

```json
{
    "entryId": "<entry-uuid>",
    "requestId": "chrome-start-1",
    "targetKind": "chrome",
    "launch": {
        "executable": "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "args": ["--remote-debugging-port={port}"],
        "cwd": "C:/Work",
        "env": {}
    },
    "mcpArgs": ["--workspace", "C:/Work"]
}
```

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

## Ports and Chrome profiles

Port selection starts at 9222; start's optional basePort selects another range.
Each session reserves a candidate port before probing, preventing concurrent
launches in the same gateway from selecting it. Occupied, privileged and
OS-reserved ports are skipped. A collision after app creation fails clearly and
does not trigger automatic relaunch. Explicit live restart refuses an occupied
original port.

Chrome uses a fixed dedicated profile unless args specifies an unused
`--user-data-dir`. Occupied or unverifiable profiles fail clearly. Concurrent
Chrome targets require distinct profile directories; profiles remain after
Close. Starts and live restarts reuse the selected directory. See
[profile storage](privacy.md#chrome-profile-storage) for default paths and
retained data.

The Chrome preset adds `--no-first-run`, `--no-default-browser-check` and
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

A conflict fails before profile acquisition or application spawn and releases
the transient port claim. Port selection/probing may already have occurred.
Repair the reported list or conflicting choice explicitly; the Plugin does not
delete a disable or rewrite ambiguous arguments. Only valid ASCII feature names
and parameter values are accepted. Other launch-field environment expansion
continues to apply as described above.

Composition copies caller arguments and is idempotent. Explicit live restart
reuses the exact composed argv, profile and port. To change application args,
complete normal Close and issue a new start with a fresh requestId and the new
connection/session identities. `generic-cdp` and Chrome on other platforms keep
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
`include: ["configuration"]` exposes mcpArgs and workspace sources: explicit
directories, the system temporary-directory default and negotiated roots
forwarding. cwd does not grant file access. Negotiation alone does not prove
which roots a host supplied.

Request `include: ["diagnostics"]` only when bounded phase/outcome evidence is
needed. Includes require connectionId and can combine with toolNames;
operationId excludes those selectors. hookEventName is the sole argument
reserved for automatic Hooks. See the
[lifecycle protocol](../lifecycle-protocol.md#requests-and-status-selectors)
for complete selector rules.

For recovery, read [troubleshooting](troubleshooting.md), or return to the
[user guide](README.md).
