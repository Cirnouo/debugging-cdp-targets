---
name: debugging-cdp-targets
description: Use when inspecting or debugging a local application's CDP renderer on Windows—Google Chrome itself or a compatible Chromium/Electron application such as Obsidian—especially for extension workers or a resumable inspection session.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP Targets

Use the bundled runner to create one verified, loopback-only target and one
pinned official DevTools daemon. The sole public entry is
`scripts/cdp-session.mjs`; never call its PowerShell helper or the official CLI
directly.

Compatibility: Windows 10 or later with Node.js 24.21.0 and `npx` available.

Resolve this Skill's directory and set `$runner` to that entry. Every command
emits one JSON object unless `invoke` returns the selected tool format.

## Start

1. Run `node $runner status`. Continue an `active` session, `resume` a
   `detached` session, and do not overwrite `stale` identity.
2. Resolve the absolute executable and workspace paths.
3. Choose the adapter:
   - `chrome` only for Windows-identified Google Chrome.
   - `generic-cdp` for Obsidian or another compatible Chromium/Electron
     renderer. For Obsidian, read [references/obsidian.md](references/obsidian.md).
   - Do not claim generic Tauri/WebView2 support. A future adapter may handle
     hosts that do not accept Chromium CDP switches.
4. Add `--enable-extensions` only for Chrome extension installation, listing,
   reload, removal, action triggering, or extension service-worker inspection.
   The runner must pass its browser, CLI, category, and command capability
   gates. Pass this as a runner option alongside `--target-adapter chrome`;
   never wrap it in `--launch-argument`. Never request any PWA category; PWA
   mode is unsupported.
5. Start the verified session:

```powershell
node $runner start `
    --executable-path 'C:\Program Files\Google\Chrome\Application\chrome.exe' `
    --target-adapter chrome `
    --workspace 'C:\absolute\workspace'
```

Pass application arguments only as repeated `--launch-argument=<value>` options.
The runner owns CDP address/port and, for Chrome, profile and first-run switches.

## Inspect

Start with `node $runner invoke -- list_pages --output-format=json`, then identify
the intended target by current URL and title. For a page, take a fresh snapshot
before read-only DOM/evaluation, console, network, screenshot, or performance
inspection. For a service worker, use worker-aware evaluation, console, and
network evidence; it has no page DOM. Re-list and re-identify targets after any
navigation, reload, worker restart, or renderer replacement. Mutate only when
the user's request authorizes the effect.

On `ok: false`, report `errorCode`, `message`, and details; do not bypass the
runner. If a missing-target result says `sessionCleared: true`, the runner has
removed safe-to-discard state and has not launched a replacement. Treat
`toolMayHaveExecuted: true` as an uncertain side effect and do not retry the tool
without confirmation.

State is fixed at
`%LOCALAPPDATA%\debugging-cdp-targets\state\session.json`; the CLI cache is a
separate subtree under `%LOCALAPPDATA%\debugging-cdp-targets\cache`.

## Finish

Always present both choices and wait for an explicit selection:

- **Close this instance** — `node $runner stop --disposition Close` stops the
  daemon and requests a normal application-window close.
- **Keep this instance** — `node $runner stop --disposition Keep` stops the
  daemon, leaves the loopback CDP target open, and records `detached` for
  `node $runner resume`.

There is no default. Never force-kill the target or silently leave the daemon
running.
