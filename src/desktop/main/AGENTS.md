# Desktop bootstrap and fixed local resource admission

Apply root, source and Desktop instructions cumulatively. Before changing
bootstrap, the asset policy or their callers, read
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md)
and the [accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md).

`bootstrap.ts` owns the synchronous Electron entry. Its exact dependencies are
Electron, the pure Windows support decision, the Chromium storage owner and one
literal dynamic import of current `interface/app-main.ts`. The actual imported
`supportsWindowsApp` checks direct platform and architecture evidence before any
App path, scratch storage, privileged scheme or Main acquisition. Refusal uses
one fixed stderr message and normal Quit. Supported startup sets separate
userData and sessionData paths and registers the scheme before the non-awaited
Main import/start. Observe asynchronous rejection with the fixed sanitized stderr
message. Main retains cleanup ownership. The App build resolves only this
bootstrap's dynamic import to `./app-main.mjs`. Before editing its Chromium
resource use, read the cumulative [instance instructions](../instance/AGENTS.md).

`asset-policy.ts` owns APP_UI_URL, the complete fixed
asset route set and appAssetPath. Keep URL parsing/catch and the original method,
protocol, host, credentials, query, fragment and origin checks in order. It has
no imports or file/Electron/window acquisition. Only current interface/app-window.ts
consumes it. Unknown siblings remain pure and dependencyless. Bootstrap's one
platform/architecture guard and two fixed stderr writes are exact ambient
exceptions. Neither owner receives argv, environment, clock or network authority.

The current window retains regular-file acquisition, copied Buffer responses,
CSP/nosniff, exact sender/main-frame/URL/one-payload checks before dispatch,
sandbox/permission/navigation controls and close/load cleanup. Main startup,
configuration/save/Quit joins remain whole at their current interface owner.
