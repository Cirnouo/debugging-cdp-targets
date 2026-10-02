# Domain language

- **Target application**: application explicitly known to expose browser-level CDP.
- **Framework**: application technology; its name does not prove CDP compatibility.
- **Rendering implementation**: renderer such as Chromium or WebView2.
- **Static entry**: reusable stdio configuration cdp-target-1 or cdp-target-2.
- **Entry identity**: random UUID for one live gateway and its independent control pipe.
- **Session identity**: fresh UUID for every successful target start in an entry.
- **Current target**: verified newly launched process belonging to one session.
- **CDP endpoint**: verified loopback discovery and browser WebSocket address.
- **Official Server**: unmodified upstream chrome-devtools-mcp child for one entry.
- **Gateway**: official SDK host transport preserving upstream catalogs and results.
- **Control channel**: temporary entry-specific local IPC for lifecycle commands.
- **Disposition**: explicit Close or Keep choice without a default.
- **Kept target**: application and upstream retained within the live entry.
- **Closed entry**: reusable host transport with no attached target after normal close.
- **Recovery**: user-authorized launch from memory on the same port, with new session identity.
- **Plugin payload**: manifests, instructions, self-contained runtime, and licenses.
