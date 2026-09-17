# Obsidian renderer workflow

Obsidian is an Electron application. Use the `generic-cdp` target adapter and
leave Chrome extension tools disabled. The shared runner owns startup, port
selection, process identity, CDP validation, DevTools daemon lifecycle, and the
final Close/Keep disposition.

Do not pass a user-data directory unless Obsidian documents it and the user's
task requires it. If Obsidian is already running without CDP, Electron may
forward a new launch to that instance. Treat a new-process exit or missing
endpoint as startup failure. Do not attach to, close, restart, or take over the
pre-existing application; ask the user to save work and quit it normally.

## Establish renderer identity

After Start succeeds:

1. Invoke `list_pages --output-format=json`.
2. Find the page whose URL is exactly `app://obsidian.md/index.html`.
3. Invoke `select_page <pageId> --output-format=json`.
4. Invoke `evaluate_script` for that page with `--pageId=<pageId>`,
   `--waitForStableDom=false`, and this read-only function:

```javascript
() => {
    const vault = globalThis.app?.vault?.getName?.() ?? null;
    const theme = document.body.classList.contains("theme-dark")
        ? "dark"
        : document.body.classList.contains("theme-light") ? "light" : "unknown";
    return {
        ready: Boolean(vault && document.title && theme !== "unknown"),
        title: document.title,
        href: location.href,
        vault,
        theme
    };
}
```

Retry only this identity inspection for up to 10 seconds while Obsidian
initializes. Require `href === "app://obsidian.md/index.html"`. If readiness,
vault, or theme cannot be confirmed, report it as unknown; never infer identity
from the title alone.

## Read-only baseline

Before reproducing an issue:

1. Record the actual vault, title, URL, and light/dark theme.
2. Take a fresh snapshot; element UIDs are valid only for that renderer lifetime.
3. Record the current console-message ordering.
4. If requests matter, record the current network requests.
5. Take a screenshot only when visual comparison materially helps.

Diagnosis is read-only by default. Do not change notes, vault configuration,
plugin enablement or settings, local storage, or filesystem content to gather
evidence. Theme or plugin source changes require an explicit implementation or
fix request.

## Theme and CSS diagnosis

Use the snapshot to identify stable structure, then inspect the relevant element
with side-effect-free evaluation and `getComputedStyle()`. Adapt this function's
returned properties to the issue:

```javascript
(selector) => {
    const element = document.querySelector(selector);
    if (!element) return { found: false, selector };
    const style = getComputedStyle(element);
    return {
        found: true,
        selector,
        classes: [...element.classList],
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
        cssVariables: {
            textNormal: style.getPropertyValue("--text-normal").trim(),
            backgroundPrimary: style.getPropertyValue("--background-primary").trim()
        }
    };
}
```

Use screenshots for layout evidence and computed styles for cascade outcomes;
do not claim access to a complete graphical Styles/Cascade panel. After an
authorized source edit, confirm the project's source and output paths, run its
documented build/watch command, perform an authorized reload, and repeat the
same computed-style and screenshot checks.

## Screenshots

Take a screenshot only after the intended page, vault, theme, viewport, and
interaction state are stable. Prefer inline output. If a file is required, save
it only under a user-authorized workspace outside every vault.

For before/after comparisons, preserve viewport and interaction state, wait for
transient overlays and animations to settle, and pair the image with snapshot,
DOM, or computed-style evidence. After reload, re-establish identity and state
before capturing the comparison. If screenshots fail while identity, snapshot,
and console calls work, classify the failure as an Electron/tool compatibility
problem before changing theme or plugin code.

## Plugin diagnosis

Before editing, read the plugin manifest, package metadata, and development
instructions; discover its actual build/watch command and output location.

1. Record console and network baselines.
2. Trigger the smallest relevant plugin UI or command only when authorized.
3. Read new console errors, rejected promises, source-mapped stacks, and failed
   requests.
4. Inspect the resulting DOM/computed state and take a screenshot when visual.
5. Modify source only for an explicit implementation or fix request.
6. Build, perform an authorized reload, reselect the renderer, and repeat the
   same trigger.
7. Compare with baseline and check for new errors.

## Reload and reconnect

Before the first **Reload app without saving** in a task, obtain explicit user
confirmation. That confirmation may cover later iterative renderer reloads in
the same task, but it does not carry to a new task.

Use a fresh snapshot and guarded tool interaction to invoke the currently visible
reload command. Do not rely on a memorized internal command ID. The old renderer
may disappear before the triggering call returns; that disconnect is expected.

After every reload:

1. Wait for CDP to recover.
2. List pages again.
3. Select the new `app://obsidian.md/index.html` target.
4. Re-run the identity function and verify the expected vault and theme.
5. Rebuild console and network baselines before retesting.

If the user reloads manually, wait for completion and follow the same
reconnection sequence.

## Failure classification

| Evidence | Response |
| --- | --- |
| New process exits or no endpoint appears while an old instance is open | Treat as single-instance forwarding or ignored CDP; ask the user to quit normally. |
| Runner reports a port race | Let the runner close only its new target and try the next port. |
| Runner reports `CDP_EXPOSED` | Do not invoke the daemon; follow the runner's normal-close recovery details. |
| Runner reports owner, path, session, or endpoint mismatch | Stop; do not attach to or take over the endpoint. |
| First tool reports protocol, target, or Puppeteer errors | Record Obsidian, Electron/Chromium, CDP, and CLI versions; classify compatibility before editing source. |
| A renderer exception appears only after plugin action | Investigate the plugin and its source-mapped stack. |
| UI differs without console errors | Compare DOM, computed styles, theme variables, interaction state, and screenshots. |

## Compatibility boundaries

The upstream DevTools tooling formally targets Chrome, so Electron support is
best effort. This workflow covers the Obsidian renderer's DOM, CSS, console,
network, screenshots, interactions, and basic performance. It does not cover
Electron main-process debugging, pre-renderer startup, Node Inspector, native
dialogs, tray/taskbar UI, mobile Obsidian, or full breakpoint stepping.
