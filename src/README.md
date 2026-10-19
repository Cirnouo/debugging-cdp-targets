# Runtime source

Before implementing the singleton desktop App migration, read
[ADR 0017](../docs/adr/0017-singleton-desktop-app.md) and the
[accepted implementation plan](../.superpowers/plans/2026-10-17-singleton-app-plan.md).
The singleton App owns direct HTTP, management and native resources. The
[runtime contract](../docs/app-runtime.md) describes its startup and cleanup.

- `interface/`: synchronous Electron bootstrap, App composition and sandboxed UI.
- `application/`: existing target controller, lifecycle/registration and App orchestration.
- `domains/`: pure App/HTTP/lifecycle contracts and remaining port candidate rules.
- `gateway/`: complete Core transaction and retained registry/cleanup ownership,
    pure explicit bearer/tool-argument extraction, target evidence/identity
    models, structured launch/isolation rules, bounded clock-backed diagnostics
    and complete resource-generation/directory-lease lifetime in `connections/`,
    plus supplied Official options, wire-terminal values and release evidence in `official/`.
- `host-plugins/`: pure payload byte proof and own-endpoint overlays.
- `adapters/`: CDP transport, official Server/catalog and native process/OS I/O.
- `shared/`: request facilities, cross-layer types and constants, and supplied
    portable payload-path syntax.
- `AGENTS.md`: dependency, gateway transport, and transient identity constraints.

[ADR 0015](../docs/adr/0015-explicit-data-directory-isolation.md) assigns the
isolation boundary: gateway/targets/model/ validates directory intent and opaque binding;
adapters acquire/reverify/remove real directories; gateway/connections holds leases
across restart; gateway/registry joins cleanup and Core exposes evidence only through explicit
operation metadata or selected configuration.

`packaging/` owns maintained thin host inputs and shared Skill/documentation.
Generated payloads live in `plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/`. They contain no executable runtime,
Hooks, dependency installation or official Server. The App delivers verified
ordinary Node, the complete unchanged official release and native loading closure.
Test-only HTTP composition is under `tests/fixtures/`, outside delivery.

Deployment metadata and permission validation live in `domains/app-deployment.ts`.
`adapters/app-deployment.ts` owns the canonical documents and both persistent
lease inodes, exposing separate reader and trusted writer opens.
`adapters/app-deployment-native.ts` supplies concrete native account, ancestor,
volume and object evidence. Its fixed Windows C#/PowerShell and macOS JXA
helpers perform read-only queries; source checks do not establish native
acceptance. These deployment modules remain outside App entry composition.
Create-only enrollment awaits the complete verified payload producer.
