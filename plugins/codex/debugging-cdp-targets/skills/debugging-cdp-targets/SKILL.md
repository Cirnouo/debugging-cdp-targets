---
name: debugging-cdp-targets
description: Use when an Agent needs to inspect a local Chrome browser or another explicitly CDP-capable application's browser-level renderer through the official Chrome DevTools MCP tools.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP targets

Use the cdp-targets MCP gateway. Start with `dct_connection_status({})` to
discover entryId and connections. Each newly launched target has independent
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
then use its returned cursor until complete. Its bounded event wait
chooses the waiting interval. A cancelled wait leaves the operation running;
`dct_operation_cancel` explicitly cancels it and reports cleanup or retained
identity. Retrying the same requestId and identical input returns the same
operation; a new intent needs a new requestId.

Use `targetKind: "chrome"` for Chrome. It uses a dedicated fixed debugging
profile; choose an explicit unused `--user-data-dir` for concurrent Chrome
targets. `{port}` works in args and env; never reuse occupied profiles or ports.

## Tool availability and routing

The global catalog is the complete official catalog, not the enabled tools of
every connection. Start/wait/status report actual enabledTools. Query
`dct_connection_status` with entryId, connectionId and
`toolNames: ["click_at", "evaluate_script"]` for exact input schemas and conditions.
Before launch, omit connectionId to query configuration requirements.

For example, click_at needs experimentalVision=true with its other conditions.
TOOL_NOT_ENABLED includes missing conditions and complete suggestedMcpArgs.
Use those only in an explicitly authorized start/restart; the gateway never
silently enables tools. Slim connections retain their actual slim tool names;
the global catalog remains full. Working directory does not grant file access:
use official `--workspace` directories and inspect status workspace sources.

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
timeout/cancellation. Preserve reported identities; explicitly restart or Close
when authorized. Never automatically restart, replay tools, extend timeouts or
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
Close requests normal shutdown and reports detailed retained identity on failure.
Never force-kill. `dct_connection_end_task` ends work while retaining a live target.

`dct_connection_restart` requires entryId, connectionId, sessionId and requestId;
optional mcpArgs explicitly replaces configuration. It preserves the connection
and original port, creates a new session, and invalidates old page IDs.
Old operations cannot cancel a later session.

Enabled, authorized host Hooks deliver operation results, connection errors and
active-task exit reminders at task boundaries. Review and enable the four definitions
using the current host's Plugin/Hook controls, described in the installed Plugin guide.
Idle chats receive events next turn; they are not
woken automatically. A process-exited reminder asks whether to restart or end
dependent work. Keep other connections usable. hookEventName is reserved for
automatic Hooks. All runtime identities and operation queues stay in memory.

If these lifecycle tools are absent, report a plugin/runtime version mismatch.
Use an updated plugin in a new chat once installation is authorized; do not
invent tool fields or fall back to a launch script.
