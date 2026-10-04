# Debugging CDP Targets

Launch a separate local Chrome browser or another CDP-capable application and
inspect it from Codex using the official Chrome DevTools MCP Server. The Plugin
provides one reusable gateway and creates an independent MCP connection for each
new target, without a fixed connection limit. Page inspection, network diagnostics,
and extension tools come directly from the official Server.

Version 0.1.0 is under development and has not been released.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute and [SECURITY.md](SECURITY.md)
to report a vulnerability privately.

## Requirements and compatibility

- Codex with Plugin support, and Node 24.21.0 available on PATH.
    The Plugin includes the complete official `chrome-devtools-mcp@1.10.1` release;
    creating connections needs no npm/npx, pnpm, or dependency download.
- Internet access to obtain or update the Plugin. The installed Server can initialize
    its tool catalog offline; browser tools and visited pages may require network access.
- An application that supports an argument or environment configured debugging port and exposes a
    **browser-level Chrome DevTools Protocol (CDP) endpoint**. Chrome is the
    known-compatible target. Other CDP-capable applications are best effort;
    Electron, Tauri, or WebView2 alone does not establish compatibility.

Windows has real-process verification and Chrome smoke-test coverage. Linux and
macOS have simulated CDP test coverage, but real application sessions have not
been validated. They also require `ps` and `lsof`.

Chrome extension tools require compatible Google Chrome 149 or newer. Their
presence in the tool catalog does not mean another application supports them.

## Install in Codex

Add the public GitHub repository as a Marketplace source, then install the Plugin:

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

You can also install it from Codex's Plugin browser after adding the source.
Enable the Plugin's MCP connection in a new conversation, then follow the quick
start below. Enabling the connection does not launch a browser automatically.

### Update or uninstall

Refresh the GitHub Marketplace source with:

```powershell
codex plugin marketplace upgrade debugging-cdp-targets
```

To uninstall, remove the Plugin before removing its Marketplace source:

```powershell
codex plugin remove debugging-cdp-targets@debugging-cdp-targets
codex plugin marketplace remove debugging-cdp-targets
```

## Quick start

Ask Codex to use `$debugging-cdp-targets` and describe the application and task.
For example:

```text
Use $debugging-cdp-targets to launch a separate Chrome debugging window.
Open https://example.com and inspect the page's network requests and console errors.
```

For another CDP-capable application, provide its executable path and debugging
option if you know them. Codex can check whether the application exposes the
required endpoint before using the DevTools tools.

The connection starts with no target. The Plugin only controls an application it
launches and verifies; it does not attach to an already running browser. Chrome
uses a dedicated debugging profile, separate from your usual browsing profile.

## Keep, close, or recover a target

The Plugin exposes one Desktop entry, `cdp-targets`. Each new target receives its
own connection and official Server child. Multiple targets can be inspected
concurrently: calls explicitly identify their connection and current session.
Creating a target preserves existing connections. The host connection remains
usable after normal Close, so you can launch another target without reconnecting.

Before ending work on a target, Codex asks **Close** or **Keep**. Close requests
normal shutdown of that target and its official Server, then removes the
connection. Keep retains both for later tasks. Other connections continue
working. There is no default and no force kill. If normal shutdown
fails, inspect the reported process and port and close the application manually.

If you close a window during dependent work, Codex asks whether it was accidental
and should be recovered on the same port, or intentional and work should end.
The gateway automatically observes native process exit events from launch.
Trusted Codex Hooks deliver one reminder at a tool boundary or before
the turn ends; idle chats receive it on the next turn. Enable Hooks and review
the plugin definitions through Codex's standard trust flow. Installing the plugin
does not trust its Hooks; see [Codex Hooks](https://learn.chatgpt.com/docs/hooks).
After Keep/end-task, a live target remains usable; its later exit silently removes
its connection and official Server. Reuse resumes task monitoring automatically.
CDP or Server failure with a live process reports a connection error.
Recovery is explicit, retains connection
identity, launch arguments,
working directory and profile from memory, refuses an occupied original port,
and creates a new session identity requiring fresh page IDs. No tool calls replay automatically and no session
state is saved across host connections.

## Data and privacy

Target identity, launch settings and operation events are held in memory.
Windows elevation uses an authenticated one-shot helper pipe; app data never
appears in its command line. The Plugin
does not log launch commands, page contents, cookies, network or console data,
secrets, or tool calls.

The official Server's usage statistics and CrUX lookups are disabled by default.
Debugging tools and the pages you open can still make network requests; these
defaults are not a guarantee that all upstream tools work offline.

The official Server is delivered at `<plugin-root>/dist/official-server/`. Every
published file is verified before each Server launch. Missing or changed files
require reinstalling the Plugin, or rebuilding it in a contributor checkout.
Only the official child's environment disables its automatic update check.

Chrome retains its debugging profile separately:

| Storage | Windows | Linux/macOS |
| --- | --- | --- |
| Default Chrome debugging profile | `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile` | `~/.cache/chrome-devtools-mcp/chrome-profile` |

The Chrome profile retains browser data, including cookies and browsing state.
Starts and recovery reuse this fixed default directory. Occupied or unverifiable
profiles fail clearly; explicitly choose another --user-data-dir for concurrency. Profiles are retained after Close for inspection.
Older npm/package caches are no longer used; upgrades leave them and existing
profiles, user configuration and global Skills in place.

CDP provides powerful access to the application being debugged. Both the Plugin's
CDP transport and the target's debugging endpoint must listen on loopback only.
Never expose or tunnel these ports to a network. Loopback does not protect
against malicious software running as your user.

## MCP lifecycle and launch configuration

The plugin manages targets directly through MCP:

| Tool | Behavior |
| --- | --- |
| `dct_connection_status` | Discovery, connection/operation status, tool requirements and automatic Hooks. |
| `dct_connection_start` | Accept a structured new launch and return an operation immediately. |
| `dct_connection_restart` | Explicitly replace one session, optionally with new mcpArgs. |
| `dct_connection_stop` | Apply the user’s Close/Keep choice to one session. |
| `dct_connection_end_task` | End work and retain a live target/upstream. |
| `dct_operation_wait` | Wait for operation events/results using a replay cursor. |
| `dct_operation_cancel` | Cancel the selected operation and report actual cleanup. |

Except initial empty status discovery, requests identify entryId. Restart,
end-task and stop also require connectionId and sessionId; start accepts neither.
Mutations use a requestId: identical retries return the original operation;
different input cannot reuse that identifier. Cancel is idempotent for its
operation and cannot affect a newer session.

Call `dct_connection_start` with structured application settings:

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

Windows launch is a plugin capability: maintained native helpers inspect manifests
and compatibility settings, preserve argv/cwd/environment across ordinary or elevated
creation, and observe the actual app PID, creation time and process handle.
Windows policy determines whether authorization appears. Permission waiting does
not consume the subsequent CDP readiness budget. Normal closing uses a one-shot
elevated helper when required. Agents need no startup wrapper or privilege script.

Start returns operationId immediately. Call `dct_operation_wait` with entryId,
operationId and cursor; continue with the returned cursor until complete.
The wait is bounded internally, so callers choose no polling interval. Canceling
a wait leaves the operation running; operation_cancel owns actual cancellation.
Trusted Hooks deliver new results at task boundaries without waking idle chats.

Each connection has its own `mcpArgs: string[]`, separate from application args/env.
The gateway reserves endpoint/browser-launch options and rejects configuration
files or CLI mode overrides. Configuration changes require explicit restart.

The gateway advertises a fixed full official catalog because Codex does not refresh
ordinary local MCP tools from list-changed notifications. Start/wait/status report
actual enabledTools. Status with toolNames returns activation conditions, complete
suggestedMcpArgs and the selected connection’s exact input schemas.
TOOL_NOT_ENABLED never enables a feature or restarts a target. For example, click_at
additionally needs `--experimentalVision=true`; `--slim` limits actual connection
tools without shrinking Codex’s global catalog. PWA tools require an official
pipe-launched browser and are marked unsupported for managed CDP connections.

Official calls carry `_dct: { connectionId, sessionId }`. Only that field is removed
before forwarding original arguments; official names, execution and results stay
unchanged. Restart preserves connectionId and the original port but creates a
new session. Obtain fresh page IDs with list_pages.

Use official `--workspace` for file access. Status distinguishes explicit directories,
the system temporary-directory default and negotiated roots forwarding. cwd does
not grant file access. Negotiation alone does not prove which roots a host supplied.

### Ports and Chrome profiles

`{port}` works in application args/env. `%NAME%` and `${NAME}` expand within
structured fields. No shell parsing or command-string interface is involved.
Without a placeholder or explicit debugging port, the plugin appends the Chromium
debugging-port argument. Other CDP runtimes use their documented args/env.

Port selection starts at 9222; start’s optional basePort selects another range.
Occupied, privileged and OS-reserved ports are skipped. Explicit restart refuses
an occupied original port. Chrome uses a fixed dedicated profile unless args
specifies an unused --user-data-dir. Concurrent targets require distinct profiles;
profiles remain after Close.

The Chrome preset adds --no-first-run, --no-default-browser-check and
--disable-updater-scheduler to this launched process only, preserving explicit
switches. It does not modify updater services.

Server defaults enable extensions and disable usage statistics/CrUX. Per-connection
mcpArgs can override them. Gateway environment defaults DCT_EXTENSIONS,
DCT_USAGE_STATISTICS and DCT_PERFORMANCE_CRUX accept true/false.

## Troubleshooting

- **Bundled official package verification failed**: reinstall the Plugin or run
    `pnpm build:plugin` in a prepared contributor checkout. Runtime does not fetch replacements.
- **Missing, unknown or stale routing identity**: refresh
    `dct_connection_status` and use the target's connection/current session UUIDs.
    Recovery changes session identity; Close removes the connection.
- **The recovery port is busy**: identify its owner and resolve the conflict
    before retrying; recovery retains the original port and target identity.
- **The application has no verified CDP endpoint**: check the executable path,
    debugging option, and browser-level endpoint support. A framework name alone
    does not establish compatibility.
- **CONNECTION_RECOVERY_REQUIRED**: the affected upstream is isolated after timeout
    or cancellation, transport pending state is cleared, and app identity remains
    available for explicit restart or normal Close. Other connections remain usable.
- **Chrome reports a locked profile**: close that Chrome instance manually,
    or explicitly select another dedicated `--user-data-dir`.

If normal shutdown fails, inspect the reported PID and port, confirm the
application's identity, and close it manually. Replace `<reported-pid>` and
`<reported-port>` with the values from the Plugin's diagnostic. On Windows:

```powershell
Get-Process -Id <reported-pid>
Get-NetTCPConnection -State Listen -LocalPort <reported-port>
```

On Linux/macOS, use `ps -p <reported-pid>` and
`lsof -nP -iTCP:<reported-port> -sTCP:LISTEN`. Closing a window does not release
the port if the owning process remains alive.

## Dependency security

Build-time checks audit dependencies for known vulnerabilities and verify npm
registry signatures. See the [supply-chain policy](docs/policies/supply-chain.md)
for details. Both the build and isolated audit use the reviewed release and
committed locks. Every published file is bound to maintained SHA-256 evidence.
The release embeds vendor libraries outside its npm dependency graph: graph
audits do not establish vulnerability coverage for those embedded libraries.
Their original inventory and license notices are preserved. The Plugin does not
perform a runtime vulnerability audit.
