# Debugging CDP Targets

A Codex Plugin that connects Codex directly to the official Chrome DevTools MCP
Server over stdio, while helping you launch and switch local debugging targets.
The Plugin does not wrap MCP tools: page inspection, network diagnostics, and
extension tools are the upstream tools.

Version 0.1.0 is under development and has not been released.

## Requirements and compatibility

Install Node 24.21.0 with npm/npx available on PATH. No global npm package or
mise dependency is required. Package acquisition needs internet access once;
the official Server is pinned to chrome-devtools-mcp 1.9.0.

The target must support a command-line option that opens a **browser-level
Chrome DevTools Protocol endpoint** on a selected port. Chrome is the
known-compatible target. Other CDP-capable applications are best effort: being
built with Electron, Tauri, or WebView2 does not prove compatibility.

Windows has real-process verification and Chrome smoke coverage. Linux and
macOS have portable code and simulated CDP tests, but real application sessions
have not been validated. They also require `ps` and `lsof`.

## Install in Codex

Add this repository as a local Marketplace source:

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
```

Then install it in Codex's Plugin browser or with
`codex plugin add debugging-cdp-targets@debugging-cdp-targets`, and enable its
MCP connection in a new conversation. Until the implementation is
pushed to GitHub, use a local checkout instead:

```powershell
codex plugin marketplace add "D:\Projects\Personal\debugging-cdp-targets"
```

Refresh a Git source with `codex plugin marketplace upgrade`. Uninstall with
`codex plugin remove debugging-cdp-targets@debugging-cdp-targets` before removing its Marketplace with
`codex plugin marketplace remove debugging-cdp-targets`. The GitHub command
cannot install unpushed changes. No npm package or Skills CLI installation is
needed; this distribution is a Codex Plugin, not a standalone cross-Agent Skill.

## Use

Ask Codex to use `$debugging-cdp-targets` and describe what you want to debug.
The MCP connection starts with **no target**. It must not silently open Chrome.

The Agent uses a separate control command to launch the application, then calls
the official MCP tools directly. For manual control, resolve the installed Plugin
root and run:

```powershell
node "<plugin-root>/dist/control.mjs" status
node "<plugin-root>/dist/control.mjs" start --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
node "<plugin-root>/dist/control.mjs" stop --disposition Close
```

Use `--target-kind generic-cdp` for another known CDP-capable application.
Provide the complete command with an absolute executable path. Quote paths with
spaces. The command is parsed into argv, **not executed by a shell**: pipes,
redirects, command substitution, and shell scripts are not supported. Environment
variables `%NAME%` and `${NAME}` expand within individual arguments.

`{port}` becomes the selected free, non-reserved port. It can appear after a
space, equals sign, or colon, according to your application's option syntax.
Without it, the Plugin appends `--remote-debugging-port=<port>`. Use
`--base-port 9222` to choose the first candidate; occupied and OS-excluded ports
are skipped. An explicit Chromium debugging port conflicting with the selected
port is rejected. Custom option names require a correct `{port}` template.

## Chrome recommendations

Without an explicit override, Chrome uses
`%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile` on Windows, or
`~/.cache/chrome-devtools-mcp/chrome-profile` on Unix. Supply
`--user-data-dir` to use another dedicated profile. Do not reuse a profile
already locked by another Chrome process.

The Server enables extension tools and disables usage statistics and CrUX.
Only use extension tools with compatible Google Chrome (149 or newer);
their presence in the catalog does not mean another application supports them.
Explicit Plugin environment overrides are:

- `DCT_EXTENSIONS=true|false`
- `DCT_USAGE_STATISTICS=true|false`
- `DCT_PERFORMANCE_CRUX=true|false`

Changing these requires restarting the MCP connection. The default avoids
upstream usage reporting and external CrUX lookups; the Server remains an
upstream dependency, not a guarantee about every future tool's network behavior.

## Switching, keeping, and closing

Version 0.1.0 supports one active Plugin MCP connection per operating-system
user. Disconnect it before enabling the Plugin in another conversation; a second
connection is refused rather than sharing or replacing the first controller.
Within that connection, only one target is attached. Before switching or finishing,
the Agent asks you to choose **Close** or **Keep**; there is no implicit choice.

- Close requests normal shutdown of the verified process this Plugin launched.
  It never escalates to a force kill.
- Keep disconnects control and preserves the application and its CDP port.
  Other local processes can still control that application.
- Switch uses `switch --launch-command ... --disposition Close|Keep`.
  In-flight CDP requests block switching. After switching, the Agent must call
  `list_pages` again and discard all previous page IDs.

There is no session file, list of sessions, cross-conversation Resume, or
automatic attachment to an existing browser. An unexpected, handled MCP
disconnect attempts normal shutdown; force-terminating the Plugin cannot
guarantee cleanup.

## Data and recovery

Target identity and command arguments exist only in memory. The temporary
named pipe/Unix socket is a control channel, not a saved session. The package
cache is separate: on Windows it is below
`%LOCALAPPDATA%\debugging-cdp-targets\cache\mcp-server`; on Unix,
`~/.cache/debugging-cdp-targets/cache/mcp-server`. It can be deleted while no
connection is using it; the next connection must download the package again.
The Chrome profile intentionally retains browser data and is not this cache.

CDP is a high-privilege interface. Both the stable router and verified target
must listen on loopback only. This is not a security boundary against malicious
software running as your user. Never expose or tunnel the ports to a network.

If normal shutdown fails, use the reported PID and port to inspect the exact
application and close it manually. On Windows:

```powershell
Get-Process -Id <reported-pid>
Get-NetTCPConnection -State Listen -LocalPort <reported-port>
```

On Linux/macOS use `ps -p <pid>` and `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
Closing a window does not release the port if its owning process remains alive.
Old experimental session directories and standalone Skills are not migrated or
deleted by this Plugin.

## Dependency security

Build CI checks the complete repository dependency graph and a separately
resolved copy of the pinned official Server dependency graph for known
vulnerabilities and npm registry signatures. High/critical findings normally
block builds; any temporary exception requires an exact, evidenced review and
expires within 30 days. Failed signature or registry checks cannot be waived.
Dependency scripts are disabled before this CI gate.

These are point-in-time build checks, not a promise that every dependency is
safe. The Server is downloaded separately when you run the Plugin; its future
resolved dependencies may differ from those checked in CI. This change adds no
runtime audit, telemetry, security-service account, or browser activity.
