# Debugging CDP Targets

Launch a separate local Chrome browser or another CDP-capable application and
inspect it from Codex using the official Chrome DevTools MCP Server. The Plugin
helps you launch and switch debugging targets; page inspection, network
diagnostics, and extension tools come directly from the official Server.

Version 0.1.0 is under development and has not been released.

## Requirements and compatibility

- Codex with Plugin support, and Node 24.21.0 with npm/npx available on PATH.
    No global npm package, pnpm, or mise installation is needed to use the Plugin.
- Internet access for installation and the first download of the official Server,
    pinned to `chrome-devtools-mcp@1.9.0`.
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
codex plugin marketplace upgrade
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

## Switch, keep, or close a target

Version 0.1.0 supports one active Plugin MCP connection per operating-system user
and one attached target within that connection. Disconnect the connection before
enabling the Plugin in another conversation.

Before switching targets or finishing a task, Codex asks you to choose:

- **Close**: request normal shutdown of the verified application the Plugin
    launched. If it cannot close normally, the Plugin reports the process and port
    for manual recovery. It never escalates to a force kill.
- **Keep**: disconnect control while leaving the application and its CDP port
    running. Other local processes can still control that application.

There is no default choice. Switching is blocked while a CDP request is in
flight; retry once it finishes. After a switch, refresh the page list and discard
previous page IDs. There is no saved session or cross-conversation Resume.

An unexpected disconnect handled by the Plugin attempts normal shutdown of its
current target. Forcibly terminating the Plugin cannot guarantee cleanup.

## Data and privacy

Target identity and launch arguments are held in memory. The temporary named
pipe or Unix socket is a local control channel, not a saved session. The Plugin
does not log launch commands, page contents, cookies, network or console data,
secrets, or tool calls.

The official Server's usage statistics and CrUX lookups are disabled by default.
Debugging tools and the pages you open can still make network requests; these
defaults are not a guarantee that all upstream tools work offline.

The Plugin uses two separate storage locations:

| Storage | Windows | Linux/macOS |
| --- | --- | --- |
| Official Server package cache | `%LOCALAPPDATA%\debugging-cdp-targets\cache\mcp-server` | `~/.cache/debugging-cdp-targets/cache/mcp-server` |
| Default Chrome debugging profile | `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile` | `~/.cache/chrome-devtools-mcp/chrome-profile` |

The package cache contains downloaded dependencies. You can delete it while no
connection is using it; the next connection needs to download the package again.
The Chrome profile retains browser data, including cookies and browsing state.
Deleting the package cache does not clear the profile.

CDP provides powerful access to the application being debugged. Both the Plugin's
CDP router and the target's debugging endpoint must listen on loopback only.
Never expose or tunnel these ports to a network. Loopback does not protect
against malicious software running as your user.

## Advanced usage

### Manual target control

Codex normally manages targets for you. For manual control, replace
`<plugin-root>` with the installed Plugin directory containing `plugin.json`,
`dist/`, and `skills/`. You can locate it from the installed Skill file at
`<plugin-root>/skills/debugging-cdp-targets/SKILL.md`.

The following PowerShell example uses Chrome's standard Windows installation
path. Replace it if Chrome is installed elsewhere, and enable the MCP connection
before running the control commands:

```powershell
node "<plugin-root>/dist/control.mjs" status
node "<plugin-root>/dist/control.mjs" start --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}'
```

After starting a target, use the official MCP tools directly. Call `list_pages`
to identify the page you want to inspect.

To switch to a new target, choose Close or Keep for the previous one and provide
the new launch command. This example closes the previous target normally:

```powershell
node "<plugin-root>/dist/control.mjs" switch --target-kind chrome --launch-command '"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port={port}' --disposition Close
```

Call `list_pages` again after switching. To stop controlling the current target,
run one of these commands according to your choice:

```powershell
node "<plugin-root>/dist/control.mjs" stop --disposition Close
node "<plugin-root>/dist/control.mjs" stop --disposition Keep
```

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
or `switch` to choose another starting point. Occupied, privileged, and
OS-excluded ports are skipped.

### Chrome profiles

With `--target-kind chrome`, Chrome uses the dedicated profile listed under
[Data and privacy](#data-and-privacy) unless you provide `--user-data-dir` in the
launch command. Use another dedicated directory if needed; do not reuse a profile
already locked by another Chrome process.

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

- **Another connection is active**: disconnect the Plugin's MCP connection in
    the other conversation before enabling it here. The Plugin will not replace
    that connection or take over its target.
- **The application has no verified CDP endpoint**: check the executable path,
    debugging option, and browser-level endpoint support. A framework name alone
    does not establish compatibility.
- **Switching is blocked by an in-flight request**: let the current DevTools
    request finish, then retry.
- **Chrome reports a locked profile**: close the Chrome process using that
    debugging profile normally, or select another dedicated `--user-data-dir`.

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
for details. These checks describe the dependencies resolved at build time; the
official Server is downloaded separately when you use the Plugin, and its
dependencies may resolve differently. The Plugin does not perform a runtime
vulnerability audit.
