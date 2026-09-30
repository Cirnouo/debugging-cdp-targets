---
name: debugging-cdp-targets
description: Use when an Agent needs to inspect a local Chrome browser or another explicitly CDP-capable application's browser-level renderer through the official Chrome DevTools MCP tools.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP targets

This Plugin starts the official Chrome DevTools MCP Server over stdio. Use its
DevTools tools directly for inspection; the separate local control command only
manages the target application. Never use a DevTools CLI wrapper or call an
`invoke` action.

The target application must support a command-line remote debugging port and
expose a browser-level CDP endpoint. Chrome is the known-compatible target;
other CDP applications may differ, so inspect their behavior rather than
assuming Chrome-specific capabilities. Do not claim universal Electron, Tauri,
or WebView2 compatibility.

This release allows one active Plugin MCP connection per OS user. If another
conversation owns it, ask the user to disconnect that connection first; do not
control or replace its target.

The file is `<plugin-root>/skills/debugging-cdp-targets/SKILL.md`; resolve two
parents above its containing directory to get the Plugin root, then run
`node <plugin-root>/dist/control.mjs <action>`. The actions are `status`,
`start`, `switch`, and `stop`:

```powershell
node "<plugin-root>/dist/control.mjs" status
node "<plugin-root>/dist/control.mjs" start --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
```

The launch command is parsed into argv without a shell. `{port}` is replaced
with an available non-reserved port. If absent, the Chrome
`--remote-debugging-port=<port>` switch is appended. On Windows, Chrome
defaults to `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile`; a
command-line `--user-data-dir` overrides it. Never attach to a process the
Plugin did not launch.

After `start`, call the official `list_pages` tool and identify the intended
target from fresh URL/title evidence. Use other official DevTools tools directly.
The Server exposes extension tools by default; call them only for a verified
Google Chrome target with major version 149 or newer. The default Server
settings disable usage statistics and CrUX.

Before changing targets or ending the task, ask the user to choose **Close**
or **Keep**. There is no default. For a switch, pass
`--disposition Close|Keep` with a new `--launch-command`; for the last target,
run `stop --disposition Close|Keep`. Keep leaves the application and loopback
CDP port reachable to other local processes. Close requests normal shutdown
only; if it fails, report the retained process and do not force-kill it.

After switching, call `list_pages` again and discard every old page ID. There
is no cross-connection Resume or session file. If the MCP connection ends
unexpectedly, the Plugin attempts to close its target; a forcibly terminated
Plugin cannot guarantee cleanup, so ask the user to inspect the process and
listening port manually.
