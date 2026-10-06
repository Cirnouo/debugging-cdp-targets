# Troubleshooting

Use the reported target identity when investigating a failure. Explicit recovery
affects the selected connection; other connections remain usable. The Plugin
never automatically restarts an application or replays a tool call.

## Common failures

- **Bundled official package verification failed**: reinstall the Plugin or run
    `pnpm build:plugin` in a prepared contributor checkout. Runtime does not fetch
    replacements. See [package integrity](privacy.md#bundled-official-package-integrity).
- **Missing, unknown or stale routing identity**: refresh
    `dct_connection_status` and use the target's connection/current session UUIDs.
    Live restart changes session identity; actual exit removes the connection.
- **The restart port is busy**: identify its owner and resolve the conflict before
    retrying; live restart requires the exact original port. After ordinary app
    exit, use a new start with new connection/session identities.
- **The application has no verified CDP endpoint**: check the executable path,
    debugging option, and browser-level endpoint support. A framework name alone
    does not establish compatibility.
- **CONNECTION_RECOVERY_REQUIRED**: the affected upstream is isolated after timeout
    or cancellation, transport pending state is cleared, and app identity remains
    available for explicit live restart or normal Close. After actual app exit its
    session is removed. Other connections remain usable.
- **Chrome reports a locked profile**: close that Chrome instance normally and
    manually, or explicitly select another dedicated `--user-data-dir`.

See [actual exit and live restart](workflow.md#actual-exit-and-live-restart) before
choosing recovery and [configuration](configuration.md) for launch settings.

## Normal manual close

If normal shutdown fails, inspect the reported PID and port, confirm the
application's identity, and close it manually. Replace `<reported-pid>` and
`<reported-port>` with the values from the Plugin's diagnostic. On Windows:

```powershell
Get-Process -Id <reported-pid>
Get-NetTCPConnection -State Listen -LocalPort <reported-port>
```

On Linux/macOS, use `ps -p <reported-pid>` and
`lsof -nP -iTCP:<reported-port> -sTCP:LISTEN`. Closing a window does not release
the port if the owning process remains alive. Use normal application shutdown;
the Plugin does not force-kill applications.

## Minimized screenshots

If an independently verified Chromium target stalls when its window is
minimized, an isolated new launch can explicitly use
`--enable-features=CDPScreenshotNewSurface` in `launch.args`. The
[shared Skill](../../packaging/shared/skills/debugging-cdp-targets/SKILL.md#conditional-minimized-screenshot-compatibility)
explains safe handling of an existing feature list, explicit disable choices,
ambiguous switches and the first `--` boundary. The Plugin does not add this
feature by default; support must be checked for the particular application.
This guidance does not change WebView2 environment settings or personal profiles.

Restart keeps the exact original application arguments. To change them, choose
normal Close, wait for it to complete, then start with the updated `launch.args`
and a fresh requestId. Use the new returned connection/session and page IDs.
Validate fresh image content while the same native window remains minimized.
The 60-second timeout, quarantine and explicit recovery still apply. See
[the dated screenshot research and acceptance limits](../mcp-native-validation.md#minimized-screenshot-follow-up-2026-10-05)
for measured evidence and the scope of acceptance.

Return to the [user guide](README.md).
