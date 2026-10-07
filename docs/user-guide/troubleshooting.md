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
- **A directory is occupied or occupancy is unverifiable**: leave the requested
    application unlaunched. Known same-directory/shared-namespace use, uncertain
    attribution of a related running app and incomplete inspection block start.
    Do not remove locks, notify/take over an existing instance or silently select
    another directory. An occupied-or-unverifiable marker is not proof of a
    positively identified running Chrome process.
- **Required launch values are unresolved**: obtain the actual executable and any
    required cwd/env from applicable authorization or read-only installation/startup
    facts. Keep missing values pending; another request or example path is not evidence.
- **Isolation support is partial, unsupported or unknown**: partial explains remaining
    production effects and asks accepted partial scope or none; unsupported only
    informs and stays unlaunched; unknown continues applicable research and stays
    unlaunched. App support through cwd alone is a separate Plugin expression
    limitation because `{dataDir}` binds only through args/env.
- **Regular Chrome 136+ cannot debug its default production directory**: report the
    documented CDP limitation and leave unlaunched even when the profile is free.
    A none choice never silently selects the preset or another isolation directory.
    Chrome for Testing has the documented exception; see
    [the Chrome change](https://developer.chrome.com/blog/remote-debugging-port).

See [actual exit and live restart](workflow.md#actual-exit-and-live-restart) before
choosing recovery and [configuration](configuration.md) for launch settings.

## Directory selection and cleanup

A missing existing directory, missing new parent or named-leaf collision fails
without operation switching or fallback. The program creates the managed leaf;
do not repair a failed selection by precreating it. Only an explicitly selected
Chrome preset permits Agent preparation of absent `.cache` and
`chrome-devtools-mcp` container ancestors after the cleanup choice.
Ancestor files/access or identity failures/leaf races stop that selection;
containers remain after selected-leaf cleanup.

The common occupancy gate applies in none and data-dir, including existing,
preset, named/random new and fully delegated choices. New-directory uniqueness
or multi-instance documentation alone is insufficient. Generic checks use
bounded related-process/native-identity evidence rather than guessed Chrome locks
or application-name matches. Complete related-app absence can clear a point-in-time
gate subject to applicable known locks, without requiring an otherwise unavailable
normal root. It does not establish isolation capability/binding.
Generic occupancy remains Agent workflow; Chrome's known explicit-root native
guard does not independently resolve omitted default roots across installation,
policy and environment variations.

For retained or cleanup-failed directories, read the original start operation's
explicit isolation metadata, including after failed/cancelled startup or route
removal. Selected configuration also exposes evidence while the connection exists.
Tell the actual real absolute path, selected policy and current state. Do not
infer deletion from Close/cancelled startup or manually delete a leased directory.
Failed Close/observation/live acquisition/resources hold the lease; changed root
identity or external Chrome occupancy prevents deletion. In-memory cleanup retry
does not restore a route or start/replay work. A hard crash cannot promise future cleanup.
See [storage and cleanup](privacy.md#data-directory-storage-and-cleanup).

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

Windows `targetKind: "chrome"` automatically receives the bare
`CDPScreenshotNewSurface` application feature. Use the ordinary Chrome launch;
users can switch windows or minimize Chrome without a screenshot foreground
checklist. The Plugin does not focus or restore a window for capture. See
[configuration](configuration.md#windows-chrome-screenshot-feature) for the fixed
rule and [the dated controlled comparison](../mcp-native-validation.md#controlled-chrome-window-state-follow-up-2026-10-07)
for the measured static states and limits.

If startup reports a feature conflict, preserve the supplied arguments and
explicitly correct the reported input. An effective target disable, decorated
or repeated target, ambiguous switch, non-ASCII feature value or malformed
enable entry is rejected before data directory acquisition/spawn. A repeated colon in
`Other:one/two:three/four` invalidates the entire enable list; appending the target
cannot repair it. The Plugin releases any transient port claim and supplies an
actionable error instead of silently changing the conflicting choice.

For `generic-cdp` or another platform, feature support and its launch-argument
carrier must be independently verified for the application. A new isolated
launch can then explicitly use `--enable-features=CDPScreenshotNewSurface` in
`launch.args`, preserving valid unrelated entries and reporting conflicts. The
[shared Skill](../../packaging/shared/skills/debugging-cdp-targets/SKILL.md#conditional-minimized-screenshot-compatibility)
keeps this conditional recipe separate from the fixed Windows Chrome rule.
No framework name proves support; this recipe does not establish a WebView2
environment setting or authorize changes to personal profiles.

Restart keeps the exact original application arguments. To change them, choose
normal Close, wait for it to complete, then start with the updated `launch.args`
and a fresh requestId. Use the new returned connection/session and page IDs.
For a conditional application recipe, verify fresh image content in the intended
native window state; request acceptance or a PNG alone does not prove compatible
capture. The [2026-10-05 application matrices](../mcp-native-validation.md#minimized-screenshot-follow-up-2026-10-05)
remain dated evidence for their specific environments. The 60-second timeout,
quarantine and explicit recovery still apply to every route; never focus,
restart or replay implicitly after a failure.

Return to the [user guide](README.md).
