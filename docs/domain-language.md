# Domain language

- **Target application**: an application the caller knows can expose browser-level
  CDP through command-line launch options. Chrome and Obsidian are applications.
- **Framework**: technology used to build an application, such as Electron or
  Tauri. A framework name does not prove CDP launch compatibility.
- **Rendering implementation**: a renderer such as Chromium or WebView2.
- **Current target**: the one verified newly launched process attached to this
  MCP connection.
- **CDP endpoint**: the target's loopback HTTP discovery and browser WebSocket.
- **Stable CDP entry**: the Plugin's loopback HTTP/WebSocket address that remains
  unchanged while the current target changes.
- **Official Server**: the unmodified upstream chrome-devtools-mcp Server using
  stdio directly with Codex.
- **Control channel**: temporary local IPC for start/status/switch/stop, separate
  from MCP tool traffic.
- **Disposition**: the user's Close or Keep choice for the current target.
- **Kept target**: a disconnected application whose window and CDP listener may
  remain open; it is not resumable Plugin state.
- **Plugin payload**: the installable manifests, instructions, bundled runtime,
  and required licenses.
