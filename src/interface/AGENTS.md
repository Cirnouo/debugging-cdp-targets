# Interface implementation

Before changing this layer's singleton App architecture, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md). The direct HTTP App owns
all resources; thin host plugins contain metadata, artwork and the shared Skill.

The App supports Windows x64 and arm64 only. The tiny Electron bootstrap rejects
other platform/architecture evidence synchronously before App paths, scratch
storage, privileged schemes or controlled main import. Supported startup assigns
isolated temporary Chromium paths synchronously before asynchronous initialization.
Direct main invocation repeats that support guard before native or App resource acquisition.
Main owns singleton admission, winner-only data/configuration I/O, verified
resource paths, trusted core closure and HTTP.
Normal Quit/Restart denies new requests, awaits actual startup settlement and
retained construction cleanup, then closes transports/windows and exits. Cleanup
failure preserves management UI and the OS lease for retry; never force exit.

Before changing App configuration consumers, read the cumulative
[configuration instructions](../desktop/configuration/AGENTS.md) and the
[accepted singleton plan](../../.superpowers/plans/2026-10-17-singleton-app-plan.md).
Only app-main.ts imports the store's openAppConfiguration VALUE; its AppConfiguration
and app-window.ts's AppConfiguration remain TYPE-only. app-manager.ts consumes the
model's parseAppConfiguration VALUE and AppAppearance, AppConfiguration and
AppHostSelection TYPEs. Preserve Main's pre-await save/closing flags, admitted
write/startup joins and cleanup retry responsibility; window and
renderer obtain no configuration filesystem or store authority.

Expose only inspect/configure/manage/quit/restart through the sandboxed preload.
Manage accepts only the closed domain-validated lifecycle/registration/host commands;
never expose bearer readback, target creation or arbitrary channels. Validate
unknown payloads and exact main-window/main-frame/fixed-URL sender identity before
dispatch. No general filesystem, shell, process, URL navigation or unrestricted IPC.
The renderer runs only fixed local assets, with context isolation, sandbox, no Node
integration and restrictive CSP. Preserve the Windows manager fallback when no
tray exists or activation was requested. Dormant Darwin tray-template and Linux
visible-manager selectors in app-main.ts are scheduled for complete
Windows-platform selector retirement, together with tests/app-main-lifecycle.test.ts,
this instruction file and the source map, under the
[Windows-only amendment](../../docs/adr/0017-singleton-desktop-app.md#accepted-windows-only-scope-amendment--2026-11-08).
They establish no current platform support.

MCP lives in the HTTP adapter, not the renderer. Every lifecycle request except
register carries registrationBearer explicitly; official routing carries that
bearer plus current connection/session. Never serialize trusted admin capabilities
or keep a session-wide current principal. Mutations return idempotent operations
immediately. A response ending normally does not detach a pending roots admission.
Wait cancellation differs from explicit lifecycle-operation cancellation.

Keep researched structured launch and explicit none/data-dir isolation boundaries.
Directory paths/policy/state belong only to selected configuration and explicit
operation evidence. Default summaries contain no paths or raw filesystem errors.
