# Debugging CDP Targets

Launch a separate local Chrome browser or another CDP-capable application and
inspect it from Codex using the official Chrome DevTools MCP Server. The Plugin
provides one reusable gateway and creates an independent MCP connection for each
new target, without a fixed connection limit. Page inspection, network diagnostics,
and extension tools come directly from the official Server.

Version 0.1.0 is under development and has not been released.

## Requirements and compatibility

- Codex with Plugin support, and Node 24.21.0 available on PATH.
    The Plugin includes the complete official `chrome-devtools-mcp@1.10.1` release;
    creating connections needs no npm/npx, pnpm, or dependency download.
- Internet access to obtain or update the Plugin. The installed Server can initialize
    its tool catalog offline; browser tools and visited pages may require network access.
- An application that supports a command-line debugging port and exposes a
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

Target identity and launch arguments are held in memory. The temporary named
pipe or Unix socket is a local control channel, not a saved session. The Plugin
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

## Advanced usage

### Manual target control

Codex normally manages targets for you. For manual control, replace
`<plugin-root>` with the installed Plugin directory containing `.codex-plugin/plugin.json`,
`dist/`, and `skills/`. You can locate it from the installed Skill file at
`<plugin-root>/skills/debugging-cdp-targets/SKILL.md`.

Call `dct_connection_status` with `{}` to obtain the gateway entry UUID and its
connections. Each target has a connection UUID and current session UUID.
Every CLI command requires `--entry-id`; restart, end-task and stop additionally
require `--connection-id` and `--session-id`. Status optionally selects a
connection and prohibits session identity; start creates a new connection and
accepts neither connection nor session identity. Only stop accepts disposition.
Never infer an identity from the static entry name.

```powershell
node "<plugin-root>/dist/control.mjs" status --entry-id <entry-uuid>
node "<plugin-root>/dist/control.mjs" status --entry-id <entry-uuid> --connection-id <connection-uuid>
node "<plugin-root>/dist/control.mjs" start --entry-id <entry-uuid> --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
node "<plugin-root>/dist/control.mjs" end-task --entry-id <entry-uuid> --connection-id <connection-uuid> --session-id <session-uuid>
node "<plugin-root>/dist/control.mjs" stop --entry-id <entry-uuid> --connection-id <connection-uuid> --session-id <session-uuid> --disposition Close
```

Actions are status, start, restart, stop and end-task. End-task ends dependent
work and retains a live target and Server; an already exited target is cleaned up. Use stop with an explicit Close/Keep
choice for disposition.
Monitoring and reminder delivery are automatic. All official tool calls require the additional
`_dct` argument, which the gateway removes before forwarding to the official
Server. For example, `list_pages` receives:

```json
{
    "_dct": {
        "connectionId": "<connection-uuid>",
        "sessionId": "<session-uuid>"
    }
}
```

Starting a target returns new connection/session UUIDs. Recovery retains the
connection UUID and replaces the session UUID. Refresh status and call official
`list_pages` with the new route for fresh page evidence. Old session and page IDs
must not be reused.

### Launch commands and ports

Use `--target-kind chrome` for Google Chrome, or `--target-kind generic-cdp` for
another known CDP-capable application. Provide the complete launch command with
an absolute executable path, and quote paths containing spaces.

Launch commands are parsed into arguments without a shell. Pipes, redirects,
command substitution, and shell scripts are not supported. Environment variables
`%NAME%` and `${NAME}` expand within individual arguments.

`{port}` is replaced with an available non-reserved port. It can appear after a
space, equals sign, or colon, according to the application's option syntax. If
neither a placeholder nor an explicit Chromium debugging port is supplied, the
Plugin appends `--remote-debugging-port=<port>`. An explicit Chromium debugging
port must match the selected port. Applications with custom option names need a
correct `{port}` template.

Port selection starts at 9222 by default. Use `--base-port <port>` with `start`
to choose another starting point. Occupied, privileged, and
OS-excluded ports are skipped.

With `--target-kind chrome`, the recommended launch preset adds
`--no-first-run`, `--no-default-browser-check` and `--disable-updater-scheduler`.
The updater switch suppresses automatic updater startup in the debugging process,
which can otherwise delay normal shutdown. It applies to that launched process
and does not change the installed updater service's configuration. Explicitly
supplied preset switches are not appended again during launch or recovery.

### Chrome profiles

With `--target-kind chrome`, Chrome uses the dedicated profile listed under
[Data and privacy](#data-and-privacy) unless you provide `--user-data-dir` in the
launch command. Use another dedicated directory if needed; do not reuse a profile
already locked by another Chrome process. The gateway also reserves directories
during launch and runtime. It never generates a replacement profile or connects
to the process holding the directory.

### Server options

The following environment variables control the official Server's optional
features. Set them in the environment used to launch the MCP connection, then
restart that connection for changes to take effect:

| Variable | Default | Effect when `true` |
| --- | --- | --- |
| `DCT_EXTENSIONS` | `true` | Enable extension tools; requires compatible Chrome. |
| `DCT_USAGE_STATISTICS` | `false` | Enable upstream usage statistics. |
| `DCT_PERFORMANCE_CRUX` | `false` | Enable external CrUX performance lookups. |

Each variable accepts only `true` or `false`.

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
- **Lifecycle change is blocked by an in-flight request**: let the current
    DevTools request finish, then retry.
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
