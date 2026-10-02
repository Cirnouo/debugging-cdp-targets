---
name: debugging-cdp-targets
description: Use when an Agent needs to inspect a local Chrome browser or another explicitly CDP-capable application's browser-level renderer through the official Chrome DevTools MCP tools.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP targets

Use either static MCP entry cdp-target-1 or cdp-target-2. Call that entry's
`dct_connection_status` with `{}` first and retain its entry UUID and current session UUID.
Each entry controls only its own newly launched, verified target. The gateway
preserves official tool schemas and results; never substitute a DevTools CLI,
custom inspection tool, or invoke action. No session survives host disconnect.

Resolve the Plugin root two parents above this file's containing directory.
Run `node <plugin-root>/dist/control.mjs <action>`. Actions are status, start,
restart, stop, and end-task; there is no switch action. Every command requires
`--entry-id <entry-uuid>`. Status and start prohibit --session-id, even when a session exists. Restart,
end-task and stop require `--session-id <current-session-uuid>`. Only stop accepts
--disposition. Refresh status
rather than guessing stale identity. Start an empty entry with:

```powershell
node "<plugin-root>/dist/control.mjs" start --entry-id <entry-uuid> --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
```

Commands parse argv without a shell. `{port}` selects an available non-reserved
port; missing Chromium port options are appended. Chrome uses a dedicated
profile unless --user-data-dir overrides it. Generic targets must explicitly
support command-line debugging and browser-level CDP; a framework name alone
does not establish compatibility. Never attach to pre-existing processes.

After start or recovery, refresh dct_connection_status, discard all old page IDs,
and call official list_pages to verify fresh URL/title evidence. Use official
inspection tools. Extension tools require verified Google Chrome 149 or newer.
Usage statistics and CrUX are disabled by default.

While doing target-dependent work, call `dct_watch_target` with `{}` concurrently
with inspection. It watches the current session and has a 25-second lease.
When it returns reason `watch-renew`, renew only while dependent work remains
active. Do not renew for an idle entry. Finish the lease with CLI end-task and both identity flags when work ends.
End-task accepts no disposition and retains target and official Server; it only
stops the active-task watch. Ask Close/Keep separately before a stop.

On loss, watch returns event {sessionId, reason}, choice restart/cancel/pending,
and nextAction restart/stop-Close/ask-user. Standard MCP form elicitation collects
the user's choice; it does not perform recovery itself. If choice is restart,
run CLI restart with this entry UUID and the event's old session UUID. If cancel,
run CLI stop with those UUIDs and --disposition Close, and terminate this target's
dependent work. For pending/ask-user, ask the user before proceeding. Other
entries remain independent. Never restart or replay automatically.

Active tasks receive form elicitation within five seconds after closure is
confirmed by an event or at least two failed polls. Idle targets ask on next use.
Authorized restart retains original argv/cwd/profile/port from memory and refuses
an occupied port. It returns a new session UUID and pageIdsInvalidated: true;
refresh status and list_pages before continuing with new page IDs.

Before selecting another entry or ending a task, ask **Close** or **Keep**, with
no default. Keep retains application and official Server together in this entry.
Close requests normal shutdown of both; the host transport remains reusable for
later start. Run stop with both identity flags and
`--disposition Close|Keep`. A failed close reports retained process/port; never
force-kill. Keep leaves loopback CDP reachable by local processes. Another entry
has its own identity and target; never control it using this entry's UUIDs.

Common mistakes: guessing IDs, reusing page IDs after recovery, treating Keep as
an upstream disconnect, silently changing a busy recovery port, or assuming
window disappearance authorizes restart. Handled MCP disconnect attempts normal
close; force termination cannot guarantee cleanup. Report unverifiable remnants
for manual inspection without taking over their processes.
