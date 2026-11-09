# Fixed local resource admission

Apply root, source and Desktop instructions cumulatively. Before changing this
policy or its window consumer, read [ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md)
and the [accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md).

Only asset-policy.ts is delivered here. It owns APP_UI_URL, the complete fixed
asset route set and appAssetPath. Keep URL parsing/catch and the original method,
protocol, host, credentials, query, fragment and origin checks in order. It has
no imports or file/Electron/window acquisition. Only current interface/app-window.ts
consumes it. Unknown siblings remain pure and dependencyless; this directory
grants no Main, Node, native, store, ambient process/clock/network or admin power.

The current window retains regular-file acquisition, copied Buffer responses,
CSP/nosniff, exact sender/main-frame/URL/one-payload checks before dispatch,
sandbox/permission/navigation controls and close/load cleanup. Main startup,
configuration/save/Quit joins remain whole at their current interface owner.
