# Debugging CDP Targets

Debugging CDP Targets is an installable Agent Skill for inspecting a newly
launched local Chrome or compatible Chromium/Electron renderer on Windows. It
wraps the official Chrome DevTools CLI in a verified, resumable session instead
of attaching to an unrelated process or letting the CLI launch an unmanaged
browser.

## Requirements

- Windows 10 or Windows 11.
- Node.js 24.21.0 with `node` and `npx` on `PATH`.
- An absolute path to the target application's executable.
- A supported agent and the [Skills CLI](https://github.com/vercel-labs/skills).

The runner downloads and pins the official `chrome-devtools-mcp` package through
`npx` when a session starts. The repository itself has no runtime npm
dependencies.

## Install

Install the Skill in the current project:

```powershell
npx skills add Cirnouo/debugging-cdp-targets --skill debugging-cdp-targets
```

Add `--global` for a user-level installation. Update or remove it with:

```powershell
npx skills update debugging-cdp-targets
npx skills remove debugging-cdp-targets
```

Use the matching `--global` option when managing a global installation.

## Security model

The runner launches a new target and owns its complete lifecycle. It chooses a
free port transactionally, binds CDP to IPv4 loopback, verifies the process
path, creation time, Windows session, listener owner, browser identity, WebSocket
endpoint, daemon PID, pinned package version, workspaces, and privacy switches.
It never attaches to, replaces, or terminates a pre-existing application.

All mutations are serialized per Windows user. Shutdown requests a normal
window close; the runner never uses a forced process kill. Official CLI usage
statistics and CrUX lookup are disabled. PWA category mode is always rejected
because it is incompatible with the verified browser URL used by the session.

## Supported target adapters

| Adapter | Intended target | Notes |
| --- | --- | --- |
| `chrome` | Google Chrome | Requires Windows file metadata identifying Google Chrome and uses a dedicated persistent Chrome profile. |
| `generic-cdp` | Compatible Chromium/Electron renderer, including Obsidian | Best-effort support; the application must honor the runner-owned CDP switches and expose a compatible endpoint. |

Tauri-built programs are applications, not a single renderer implementation.
Some use WebView2 and require activation or adapter behavior that is not
implemented in version 0.1.0. `generic-cdp` is not a universal Tauri adapter.

Extension mode is opt-in with `--enable-extensions`. It is available only for a
verified Google Chrome target when the browser version, official CLI version,
category flag, and required extension commands all pass capability checks. Use
it only for extension installation, listing, reload, removal, action triggering,
or extension service-worker inspection.

## Session lifecycle

The public runner is `scripts/cdp-session.mjs` inside the installed Skill.

1. `status` reports `none`, `active`, `detached`, or `stale` without changing the
   session.
2. `start` launches one verified target and one official DevTools daemon.
3. `invoke -- <tool> ...` sends a validated tool call through that daemon.
4. `stop --disposition Keep` stops the daemon but leaves the target open as a
   detached session; `resume` revalidates it and restarts only the daemon.
5. `stop --disposition Close` stops the daemon and requests a normal target
   window close.

Every completed task requires an explicit Close or Keep choice. There is no
default disposition. If the target disappears, the runner reports whether it
cleared the session and whether an in-flight tool may have executed; it never
starts a replacement target automatically.

## Local data and privacy

Session state is fixed at:

```text
%LOCALAPPDATA%\debugging-cdp-targets\state\session.json
```

The isolated npm runtime and package cache are under:

```text
%LOCALAPPDATA%\debugging-cdp-targets\cache\chrome-devtools-cli
```

Deleting that cache while no session is running does not reset managed state;
it causes the official CLI package to be downloaded and verified again on the
next start. Do not delete the state file to recover a live or stale session—use
`status` and the runner's lifecycle commands.

Chrome keeps its dedicated profile at
`%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile`. Keeping a session
leaves its loopback CDP listener available to other local processes until the
application closes.

The state record contains only approved process/session identity, adapter,
package version, extension mode, and authorized workspace paths. It does not
store launch arguments, tool calls or results, page data, cookies, headers,
secrets, or user input.

## Limitations

- One managed session per Windows user.
- New targets only; no takeover of an already running application.
- Renderer-level DOM, CSS, console, network, screenshot, interaction, and basic
  performance inspection. Electron main-process/Node Inspector, native dialogs,
  tray/taskbar UI, mobile targets, and full breakpoint stepping are out of scope.
- Electron support is best effort because the upstream CLI formally targets
  Chrome.
- Full Chrome DevTools MCP configuration and a dedicated Tauri/WebView2 adapter
  are future extension points, not implemented features.

## Troubleshooting

- Run `status` first. `active` can invoke tools, `detached` can resume, and
  `stale` requires identity-safe recovery rather than deleting state.
- On `{ "ok": false }`, report the returned `errorCode`, `message`, and details.
  Do not bypass a failed validation with a direct browser or daemon command.
- `SESSION_ALREADY_MANAGED` means the single session is already active or
  detached. Finish, close, or resume it before starting another target.
- `TARGET_EXITED` means the target vanished before a tool ran;
  `TARGET_EXITED_DURING_INVOKE` means the tool may have executed before the
  target vanished. Check `sessionCleared` and `toolMayHaveExecuted`.
- For Obsidian, close any existing instance normally before starting if its
  single-instance forwarding prevents the new process from exposing CDP.
- For capability or protocol failures, record the application, renderer, CDP,
  and official CLI versions before changing application code.

## License

[MIT](LICENSE) © 2026 Cirnouo.
