# Domain glossary

**Target Application** — The desktop or browser program being inspected. Google
Chrome, Obsidian, and Tauri-built programs are applications.

**Target Framework** — The application framework that packages or coordinates
the program. Electron and Tauri are frameworks.

**Renderer Runtime** — The engine that renders and executes the inspectable UI.
Chromium and WebView2 are renderer runtimes.

**Target Adapter** — The named compatibility strategy that translates a target
application's launch and identity characteristics into the managed CDP contract.

**Managed Session** — The recorded relationship among one launched target, its
verified CDP endpoint, and its verified DevTools daemon.

**Detached Session** — A managed session whose target and loopback CDP endpoint
remain available while its DevTools daemon is stopped.

**CDP Endpoint** — The loopback HTTP/WebSocket interface through which the
renderer exposes Chrome DevTools Protocol capabilities.

**DevTools Daemon** — The pinned official CLI process that translates named tool
invocations into CDP operations for the managed endpoint.
