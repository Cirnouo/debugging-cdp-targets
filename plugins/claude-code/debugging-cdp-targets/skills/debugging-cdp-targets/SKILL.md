---
name: debugging-cdp-targets
description: Use when an Agent needs to inspect a local Chrome browser or another explicitly CDP-capable application's browser-level renderer through the official Chrome DevTools MCP tools.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP targets

Use the cdp-targets MCP gateway. Start with `dct_connection_status({})` to
discover entryId and connection summaries. Each newly launched target has independent
connectionId, sessionId and official MCP. Never attach to an existing application.
A framework name alone does not establish browser-level CDP compatibility.

## Start and wait

Call `dct_connection_start` with a fresh requestId and structured launch.
For a known CDP application, adapt this example to its documented debugging
argument or environment setting:

```json
{
    "entryId": "<entry-uuid>",
    "requestId": "launch-reader-1",
    "targetKind": "generic-cdp",
    "launch": {
        "executable": "C:/Apps/Reader/reader.exe",
        "args": [],
        "cwd": "C:/Work",
        "env": { "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": "--remote-debugging-port={port}" }
    },
    "mcpArgs": ["--workspace", "C:/Work"]
}
```

The plugin detects Windows elevation requirements and launches the actual app
with its arguments, cwd and environment. Windows controls authorization prompts.
Use this native capability; Agents need no registry inspection, privilege
diagnosis, startup wrapper or launch script.

Start returns an operationId immediately. Call `dct_operation_wait` with
`{ "entryId": "<entry-uuid>", "operationId": "<operation-uuid>", "cursor": 0 }`,
then use its returned cursor until complete. Each wait lasts up to 25 seconds;
an incomplete response does not expire the operation. Continue with its cursor,
including while normal application Close is still waiting for actual exit.
A cancelled wait leaves the operation running;
`dct_operation_cancel` explicitly cancels it and reports cleanup or retained
identity. Retrying the same requestId and identical input returns the same
operation; a new intent needs a new requestId.

Use `targetKind: "chrome"` for Chrome. It uses a dedicated fixed debugging
profile; choose an explicit unused `--user-data-dir` for concurrent Chrome
targets. `{port}` works in args and env; never reuse occupied profiles or ports.

## Tool availability and routing

The global catalog is the complete official catalog, not the enabled tools of
every connection. Start/wait lifecycle results are summaries. Query status with
entryId and connectionId for enabledTools names and upstreamStatus. Query
`dct_connection_status` with entryId, connectionId and
`toolNames: ["click_at", "evaluate_script"]` for exact input schemas and conditions.
Before launch, omit connectionId to query configuration requirements. Exact
schemas require a connected, valid actual upstream; disconnected/quarantined
connections provide requirements only. Request selected
`include: ["configuration"]` for mcpArgs/workspace sources or
`include: ["diagnostics"]` for bounded diagnostics; includes can combine with
toolNames. Do not request configuration, schemas or diagnostics unless needed.

For example, click_at needs experimentalVision=true with its other conditions.
Supported explicitly disabled tools and TOOL_NOT_ENABLED include missing
conditions and complete replacement suggestedMcpArgs. Enabled tools have no
activation recipe; unsupported tools provide a reason without a recipe.
Use those only in an explicitly authorized start/restart; the gateway never
silently enables tools. Slim connections retain their actual slim tool names;
the global catalog remains full. Working directory does not grant file access:
use official `--workspace` directories and explicitly include status configuration
when inspecting workspace sources.

Every official call needs `_dct: { connectionId, sessionId }`. The gateway
removes only this routing field and preserves original arguments/results.
After start/restart, obtain fresh page IDs with list_pages for that route.
For a default connection's page, evaluate_script uses:

```json
{
    "_dct": { "connectionId": "<connection-uuid>", "sessionId": "<session-uuid>" },
    "pageId": 1,
    "function": "() => document.title"
}
```

Use the selected connection's exact schema. For default navigate_page, navigation
uses type="url" and url plus its pageId; do not copy parameters between differently
named official tools or configuration variants.

## Errors, native dialogs and task completion

CONNECTION_RECOVERY_REQUIRED means the affected upstream is isolated after
timeout/cancellation while the app remains owned. Preserve reported identities;
explicitly restart the live connection or Close when authorized. After actual
application exit its connection/session is removed; retry requires start with
new connection/session identities. Never automatically start/restart, replay tools, extend timeouts or
add a screenshot preflight/foreground checklist.

A Windows file picker is a native window. Locate it by the managed application's
identity and handle that existing dialog with available native UI capabilities.
If those capabilities are unavailable, ask the user to handle it. After cancellation,
stop repeating the import action. Official handle_dialog handles page JavaScript
dialogs, not Windows file pickers.

Before ending a target's work, obtain **Close** or **Keep** with no default, unless
the user has already supplied that choice. `dct_connection_stop` takes entryId,
connectionId, sessionId, requestId and disposition. Keep retains app/upstream;
The disposition values are exactly `"Close"` and `"Keep"`.
Close requests normal shutdown and waits for actual app exit without a target
deadline. Continue operation waits while it remains incomplete. Failed/cancelled
Close preserves live app ownership, observation and retry identity. Never
force-kill. `dct_connection_end_task` ends work while retaining live resources;
their later actual exit still removes that connection and is reported.

`dct_connection_restart` requires entryId, connectionId, sessionId and requestId;
optional mcpArgs explicitly replaces configuration. Use it only for a still-live
connection. It waits for old app exit and disposes old resources before creating
fresh resources and session on the same connection and exact original port.
It refuses a busy original port and invalidates old page IDs.
Old operations cannot cancel a later session.

Enabled, authorized host Hooks deliver compact operation notices, connection
errors and exit events at task boundaries. Review and enable the four definitions
using the current host's Plugin/Hook controls, described in the installed Plugin guide.
Idle chats receive events next turn; they are not
woken automatically. An active unexpected exit reports the removed session and
may suggest an explicitly authorized new start; inactive exit is informational.
Expected Close/restart exits belong to the operation notice's exits array, grouped
by operationId. It retains every related actual exit and cleanup result, including
old Target exit and new Target rollback during restart. Delivery may wait until
all related cleanup is ready; pending cleanup keeps both notice and exit facts
unread. Successfully reading a terminal result through operation status, complete
wait, cancel of an already terminal operation or an identical mutation retry
acknowledges that notice. Aborted requests and nonterminal responses leave it
unread. Hooks never embed complete results, errors, configuration, diagnostics,
schemas, tool names/counts or recipes. With no pending event, Hooks return {}.
Keep other connections usable. hookEventName must be the sole argument and is
reserved for automatic Hooks. operationId status cannot combine connectionId,
toolNames or include. All runtime identities and operation queues stay in memory.

If these lifecycle tools are absent, report a plugin/runtime version mismatch.
Use an updated plugin in a new chat once installation is authorized; do not
invent tool fields or fall back to a launch script.
