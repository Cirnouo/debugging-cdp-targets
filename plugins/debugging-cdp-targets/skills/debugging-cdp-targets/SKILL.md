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
restart, stop and end-task; there is no switch action. Every command requires
--entry-id. Status optionally accepts --connection-id and prohibits --session-id.
Start creates a new connection and prohibits connection/session identity.
Restart/end-task/stop require --connection-id and --session-id in addition to
entry identity. Only stop accepts --disposition. Obtain IDs from status/results,
never from the static gateway name. Launch a new target with:

```powershell
node "<plugin-root>/dist/control.mjs" start --entry-id <entry-uuid> --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
```

Commands parse argv without a shell. `{port}` selects an available non-reserved
port; missing Chromium port options are appended. Chrome uses a dedicated
profile unless --user-data-dir overrides it. Generic targets must explicitly
support command-line debugging and browser-level CDP; a framework name alone
does not establish compatibility. Never reuse a profile locked by another target.

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

While doing dependent work for each target, call `dct_watch_target` concurrently
with that target's inspection, using `{ connectionId, sessionId }` (without _dct).
Each watch has a 25-second lease. Renew after reason watch-renew only while that
target's dependent work remains active. Idle targets need no renewed watch.
Finish the watch using end-task with all three IDs; it retains target and MCP.

On loss, watch identifies the connection/session and returns choice
restart/cancel/pending and nextAction restart/stop-Close/ask-user. Standard MCP
form elicitation collects the user's choice, without automatically recovering.
If restart, use the event's old session UUID:

```powershell
node "<plugin-root>/dist/control.mjs" restart --entry-id <entry-uuid> --connection-id <connection-uuid> --session-id <event-old-session-uuid>
```

If cancel, run stop with those identities and --disposition Close, then terminate
only that target's dependent work. For pending/ask-user, ask before proceeding.
Other connections continue working. Never restart or replay tools automatically.

Active tasks receive elicitation within five seconds after loss is confirmed
by events or at least two failed polls. Idle targets ask on next use. Authorized
restart retains original argv/cwd/profile/port, refuses a busy port and returns
new session identity with pageIdsInvalidated: true. Refresh status and list_pages
before resuming with new page IDs.

Before ending or abandoning a target's task, ask **Close** or **Keep**, with no
default. Keep retains target and official MCP for later work in the same chat.
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
