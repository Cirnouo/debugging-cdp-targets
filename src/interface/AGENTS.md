# Interface implementation

Before changing this layer's singleton App architecture, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md). The direct HTTP App owns
all resources; thin host plugins contain metadata, artwork and the shared Skill.

The tiny Electron bootstrap assigns isolated temporary Chromium paths synchronously
before any asynchronous initialization. Main owns singleton admission, winner-only
data/configuration I/O, verified resource paths, trusted core closure and HTTP.
Normal Quit/Restart denies new requests, awaits actual startup settlement and
retained construction cleanup, then closes transports/windows and exits. Cleanup
failure preserves management UI and the OS lease for retry; never force exit.

Expose only inspect/configure/manage/quit/restart through the sandboxed preload.
Manage accepts only the closed domain-validated lifecycle/registration/host commands;
never expose bearer readback, target creation or arbitrary channels. Validate
unknown payloads and exact main-window/main-frame/fixed-URL sender identity before
dispatch. No general filesystem, shell, process, URL navigation or unrestricted IPC.
The renderer runs only fixed local assets, with context isolation, sandbox, no Node
integration and restrictive CSP. Linux keeps a visible manager fallback.

MCP lives in the HTTP adapter, not the renderer. Every lifecycle request except
register carries registrationBearer explicitly; official routing carries that
bearer plus current connection/session. Never serialize trusted admin capabilities
or keep a session-wide current principal. Mutations return idempotent operations
immediately. A response ending normally does not detach a pending roots admission.
Wait cancellation differs from explicit lifecycle-operation cancellation.

Keep researched structured launch and explicit none/data-dir isolation boundaries.
Directory paths/policy/state belong only to selected configuration and explicit
operation evidence. Default summaries contain no paths or raw filesystem errors.
