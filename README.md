# Debugging CDP Targets

Launch a separate local Chrome browser or another CDP-capable application and
inspect it from Codex or Claude Code using the official Chrome DevTools MCP Server.
The Plugin provides one reusable gateway and creates an independent MCP connection for each
new target, without a fixed connection limit. Page inspection, network diagnostics,
and extension tools come directly from the official Server.

Version 0.1.0 is under development and has not been released.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute and [SECURITY.md](SECURITY.md)
to report a vulnerability privately.

## Requirements and compatibility

- Codex with Plugin support, or Claude Code 2.1.283 or newer, and Node 24.21.0
    available on PATH.
    The Plugin includes the complete official `chrome-devtools-mcp@1.10.1` release;
    creating connections needs no npm/npx, pnpm, or dependency download.
- Internet access to obtain or update the Plugin. The installed Server can initialize
    its tool catalog offline; browser tools and visited pages may require network access.
- An application that supports an argument or environment configured debugging port and exposes a
    **browser-level Chrome DevTools Protocol (CDP) endpoint**. Chrome is the
    known-compatible target. Other CDP-capable applications are best effort;
    Electron, Tauri, or WebView2 alone does not establish compatibility.

Actual Plugin installation, tool discovery and model-context Hooks were accepted
on Windows on 2026-10-05 with Codex CLI 0.160.0 and Claude Code 2.1.283. Claude
Code 2.1.283 is the first supported and accepted baseline. These explicit host
smokes use isolated configuration and loopback model fixtures; see
[the smoke instructions](tests/smoke/README.md) for commands and boundaries.
Each host receives a complete independent payload from the same maintained
runtime, Skill and verified official Server release.

Real desktop Chrome acceptance passed on the following hosts on 2026-10-04:

| Tested host | Architecture | Chrome version |
| --- | --- | --- |
| Windows, OS build 10.0.26300 | x64 | 154.0.8037.98 |
| Ubuntu 24.04.5 LTS with Xvfb | x64 | 154.0.8037.57 |
| macOS 15.7.9 | arm64 | 152.0.7977.83 |

The Linux and macOS evidence comes from GitHub's `ubuntu-24.04` and `macos-15`
runners. The acceptance checks cover official page/CSS tools, concurrent independent
connections, Keep/reuse, scoped Close, same-port recovery, stale sessions and exit
cleanup. These dated results precede the actual-exit lifecycle revision in
[ADR 0013](docs/adr/0013-session-owned-exit-cleanup.md); they do not establish
acceptance of that later revision. See [the smoke instructions](tests/smoke/README.md)
for the test boundaries.
Other application/OS/browser combinations remain best effort.
Linux and macOS require `ps` and `lsof`; Linux additionally requires `getconf`
and readable `/proc` process evidence.

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

## Install in Claude Code

Add the public GitHub repository as a Marketplace source, then install the Plugin:

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

The Plugin also appears in Claude Code's `/plugin` interface after adding the
Marketplace. Restart Claude Code after installation. For an unreleased contributor
checkout, pass its absolute repository directory to `claude plugin marketplace add`.
The installed `cdp-targets` server starts with no target; using the Skill below
launches an explicitly selected application.

### Update or uninstall

Refresh the Marketplace and update the installed Plugin, then restart Claude Code:

```powershell
claude plugin marketplace update debugging-cdp-targets
claude plugin update debugging-cdp-targets@debugging-cdp-targets
```

To uninstall, remove the Plugin before removing its Marketplace source:

```powershell
claude plugin uninstall debugging-cdp-targets@debugging-cdp-targets
claude plugin marketplace remove debugging-cdp-targets
```

Installation and uninstallation default to user scope; updates automatically detect
the installation scope. Claude also supports project/local scopes; select the matching
scope when updating or removing those installations.
See the [Claude Marketplace reference](https://code.claude.com/docs/en/plugin-marketplaces).

## Quick start

Invoke the shared Skill and describe the application and task:

| Host | Skill entry |
| --- | --- |
| Codex | `$debugging-cdp-targets` |
| Claude Code | `/debugging-cdp-targets:debugging-cdp-targets` |

For example, in Codex:

```text
Use $debugging-cdp-targets to launch a separate Chrome debugging window.
Open https://example.com and inspect the page's network requests and console errors.
```

In Claude Code:

```text
/debugging-cdp-targets:debugging-cdp-targets Launch a separate Chrome debugging window.
Open https://example.com and inspect the page's network requests and console errors.
```

For another CDP-capable application, provide its executable path and debugging
option if you know them. The Agent can check whether the application exposes the
required endpoint before using the DevTools tools.

The connection starts with no target. The Plugin only controls an application it
launches and verifies; it does not attach to an already running browser. Chrome
uses a dedicated debugging profile, separate from your usual browsing profile.

## Keep, close, or restart a live target

The Plugin exposes one stdio MCP entry, `cdp-targets`. Each new target receives its
own connection and official Server child. Multiple targets can be inspected
concurrently: calls explicitly identify their connection and current session.
Creating a target preserves existing connections. The host connection remains
usable after normal Close, so you can launch another target without reconnecting.

Before ending work on a target, the Agent asks **Close** or **Keep**. Close requests
normal application shutdown and waits for actual exit, then removes that
connection and disposes its owned resources. Keep retains live app, upstream and
router for later tasks. Other connections continue working. There is no default,
target-close deadline or application force kill. Continue operation waits while
Close remains incomplete. If normal shutdown fails or is cancelled, live target
identity and observation remain available for retry or manual normal close.

The gateway observes the actual application's native exit from launch. Any actual
exit ends that session and removes its connection, including after Keep/end-task.
If work needs to continue after ordinary exit, explicitly start a new target with
new connection/session identities. Old page IDs and routes cannot be reused.
Enabled, authorized host Hooks deliver compact exit/operation/connection events
at task boundaries; idle chats receive them on the next turn. Inactive exit is
informational; an active unexpected exit may suggest a new start. Expected
Close/restart exits are grouped by operationId in its operation notice, including
any new Target rollback during restart. Delivery waits until all related cleanup
results are ready. A ready Stop event requests one continuation. Follow the host's
setup below.

CDP, Server or native observation failure while an app remains alive reports a
connection error. Explicit restart of a live connection retains its connection,
launch arguments, working directory, profile and exact original port. It waits
for old app exit and resource disposal before creating a fresh session, router
and upstream; an occupied original port fails clearly. Obtain fresh page IDs with
list_pages after restart. No launch/restart or tool replay happens automatically.
Failed resource disposal after confirmed app exit is retained internally for
gateway cleanup retries and does not keep the dead session routable.

### Automatic Hooks in each host

Both distributions provide PreToolUse, PostToolUse, UserPromptSubmit and Stop
Hooks with a three-second timeout. They call existing status and deliver pending
exit, operation and quarantine context; no event means empty JSON.

In Codex, enable Hooks and review the installed definitions through its standard
trust flow. Installing the Plugin does not trust its Hooks. The isolated acceptance
checks both trusted and untrusted definitions; see
[Codex Hooks](https://learn.chatgpt.com/docs/hooks).

In Claude Code, review the Plugin before installing/enabling it. Enabled Plugin
Hooks are discovered from `hooks/hooks.json`; they call the scoped server
`plugin:debugging-cdp-targets:cdp-targets`. Check `/hooks` to inspect active
definitions. An effective `disableAllHooks: true` setting disables their execution
while the Plugin MCP server can remain connected. Plugin enablement and these
settings are Claude's controls; see [Claude Hooks](https://code.claude.com/docs/en/hooks).
Lifecycle events require Hooks to execute in the current host.

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
Starts and live restarts reuse this fixed default directory. Occupied or unverifiable
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
| `dct_connection_restart` | Explicitly replace a live session, optionally with new mcpArgs. |
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
Each wait lasts up to 25 seconds and may return incomplete; this bounds one
response, not the operation or application Close. Canceling a wait leaves the
operation running; operation_cancel owns actual cancellation and cleanup.
Successful terminal status/wait, terminal cancel or identical mutation retry
delivery acknowledges its operation notice, preventing redundant Hook delivery.
Aborted requests and nonterminal responses leave the notice unread. Trusted Hooks
deliver compact events without waking idle chats.

Each connection has its own `mcpArgs: string[]`, separate from application args/env.
The gateway reserves endpoint/browser-launch options and rejects configuration
files or CLI mode overrides. Configuration changes require explicit restart.

The gateway advertises a fixed full official catalog because Codex does not refresh
ordinary local MCP tools from list-changed notifications. Discovery and lifecycle
successes return connection summaries. Selected status adds enabledTools names
and upstreamStatus (`connected`, `disconnected` or `quarantined`). Explicit
toolNames requests return configuration requirements and exact input schemas
only when an actual upstream is valid. Supported explicitly disabled tools and
TOOL_NOT_ENABLED provide complete replacement suggestedMcpArgs; enabled tools
have no recipe, and unsupported tools provide their reason. An unavailable
upstream supplies requirements without asserting actual schemas or enablement.
TOOL_NOT_ENABLED never enables a feature or restarts a target. For example, click_at
additionally needs `--experimentalVision=true`; `--slim` limits actual connection
tools without shrinking Codex’s global catalog. PWA tools require an official
pipe-launched browser and are marked unsupported for managed CDP connections.

Official calls carry `_dct: { connectionId, sessionId }`. Only that field is removed
before forwarding original arguments; official names, execution and results stay
unchanged. Restart preserves connectionId and the original port but creates a
new session. Obtain fresh page IDs with list_pages.

Use official `--workspace` for file access. Selected status with
`include: ["configuration"]` exposes mcpArgs and workspace sources: explicit
directories, the system temporary-directory default and negotiated roots
forwarding. cwd does not grant file access. Request `include: ["diagnostics"]`
only when bounded phase/outcome evidence is needed. Includes require connectionId
and can combine with toolNames. operationId excludes those selectors;
hookEventName is the sole argument reserved for automatic Hooks. See
[the lifecycle protocol](docs/lifecycle-protocol.md) for complete selector and
delivery rules. Negotiation alone does not prove which roots a host supplied.

### Ports and Chrome profiles

`{port}` works in application args/env. `%NAME%` and `${NAME}` expand within
structured fields. No shell parsing or command-string interface is involved.
Without a placeholder or explicit debugging port, the plugin appends the Chromium
debugging-port argument. Other CDP runtimes use their documented args/env.

Port selection starts at 9222; start’s optional basePort selects another range.
Each session reserves a candidate port before probing, preventing concurrent
launches in the same gateway from selecting it. Occupied, privileged and
OS-reserved ports are skipped. A collision after app creation fails clearly and
does not trigger automatic relaunch. Explicit restart refuses
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
    Live restart changes session identity; actual exit removes the connection.
- **The restart port is busy**: identify its owner and resolve the conflict
    before retrying; live restart requires the exact original port. After ordinary
    app exit, use a new start with new connection/session identities.
- **The application has no verified CDP endpoint**: check the executable path,
    debugging option, and browser-level endpoint support. A framework name alone
    does not establish compatibility.
- **CONNECTION_RECOVERY_REQUIRED**: the affected upstream is isolated after timeout
    or cancellation, transport pending state is cleared, and app identity remains
    available for explicit live restart or normal Close. After actual app exit its
    session is removed. Other connections remain usable.
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
