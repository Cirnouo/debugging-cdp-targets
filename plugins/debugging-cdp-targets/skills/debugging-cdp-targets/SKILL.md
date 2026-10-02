---
name: debugging-cdp-targets
description: Use when an Agent needs to inspect a local Chrome browser or another explicitly CDP-capable application's browser-level renderer through the official Chrome DevTools MCP tools.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP targets

Use the cdp-targets MCP gateway. Call `dct_connection_status` with `{}` first:
it returns entryId and connections. Each new target gets its own connectionId,
official MCP and sessionId. There is no fixed connection limit or implicit
current target. Only newly launched, verified targets are managed; never attach
to existing applications. All identities and launch settings stay in memory.

Resolve the Plugin root two parents above this file's containing directory.
Run `node <plugin-root>/dist/control.mjs <action>`. Actions are status, start,
restart, stop and end-task. Every command requires --entry-id.
Status optionally accepts --connection-id and prohibits --session-id.
Start creates a new connection and prohibits connection/session identity.
Restart/end-task/stop require --connection-id and --session-id in addition to
entry identity. Only stop accepts --disposition. Obtain IDs from status/results,
never from the static gateway name. Launch a new target with:

```powershell
node "<plugin-root>/dist/control.mjs" start --entry-id <entry-uuid> --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
```

Commands parse argv without a shell. `{port}` selects an available non-reserved
port; missing Chromium port options are appended. Chrome uses a dedicated
fixed profile at <user-home>/.cache/chrome-devtools-mcp/chrome-profile unless
--user-data-dir overrides it. Occupied or unverifiable directories fail before
launch; explicitly choose another available dedicated directory.
Use --target-kind generic-cdp only for applications explicitly supporting
command-line debugging and browser-level CDP; a framework name alone does not
establish compatibility. Never reuse a profile locked by another target.

Every official tool call requires `_dct: { connectionId, sessionId }` using the
target's current IDs. This is routing metadata: the gateway removes it before
forwarding original parameters and preserves official tool names and results.
Never substitute a DevTools CLI, custom inspection tool or generic invoke action.
For example, call official list_pages for target A with:

```json
{ "_dct": { "connectionId": "<A-connection-uuid>", "sessionId": "<A-session-uuid>" } }
```

Calls for target B use B's IDs and can run concurrently. After start or recovery,
refresh status, discard old page IDs and call list_pages with the current route
for fresh URL/title evidence. Recovery keeps connectionId but replaces sessionId.
Old sessions and closed connections are rejected. Extension tools require
verified Google Chrome 149 or newer. Usage statistics and CrUX default to off.

The gateway observes process exit automatically from launch. Start/restart and
official use activate dependent work; Keep and end-task end it.
Reusing a live kept target automatically resumes monitoring
for its new task. Empty status calls are read-only; hookEventName is reserved
for packaged automatic Codex Hooks, never an Agent monitoring request.

Enable Codex Hooks and review/trust this plugin's four definitions through the
standard Codex flow. Installation does not grant trust. See
[Codex Hooks](https://learn.chatgpt.com/docs/hooks). Without pending exit events,
Hooks add no context. An active task's unexpected exit queues one reminder with target
kind, PID, port and entry/connection/session identities. Delivery occurs at a
tool boundary or before the turn ends; idle chats receive it next turn.

On a process-exited reminder, ask the user whether to restart or end dependent
work. Keep other targets usable. Never automatically restart or replay tools.
If authorized to restart, run restart with all three IDs and the event's old
session. Recovery retains original argv/cwd/profile/port, rejects an occupied
port, returns a new session and invalidates page IDs. Refresh status and
list_pages before resuming. If work should end, apply the user's Close/Keep
choice to that connection. A CDP/upstream error while the process lives requires
inspection of the connection error; it does not prove the process exited.

Before ending or abandoning a target's task, ask **Close** or **Keep**, with no
default. Keep retains a live target and official MCP for later work in the same chat.
If it exits after Keep/end-task, the gateway silently closes that upstream and
removes only that connection; reuse its identities only while still present.
Close normally shuts down both and removes only that connection; the gateway
and other connections remain available. Use stop with all identities:

```powershell
node "<plugin-root>/dist/control.mjs" stop --entry-id <entry-uuid> --connection-id <connection-uuid> --session-id <session-uuid> --disposition Close
```

Failed close reports retained identity/PID/port for retry; never force-kill.
Keep leaves CDP reachable by local processes. Creating another target does not
end existing tasks or dispose their connections. Handled gateway disconnect
attempts normal cleanup for every connection; forced termination cannot guarantee
cleanup. Report unverifiable remnants without taking over their processes.

Common mistakes: omitting _dct, using another target's IDs, reusing session/page
IDs after recovery, treating Keep as an MCP disconnect, silently changing a busy
recovery port, or assuming window disappearance authorizes restart.
