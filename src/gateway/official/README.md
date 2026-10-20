# Official supplied rules, package-file proof and launch inputs

- `options.ts` owns reviewed public flags, parsing/recipes and deterministic
    `buildOfficialServerArguments` with explicit URL/environment/args/platform.
- `execution.ts` owns exact supplied wire identity and once-only terminal values.
- `release-evidence.ts` validates complete reviewed release and manifest evidence.
- `package-files.ts` owns `verifyOfficialPackageFiles`: the complete filesystem
    evidence/root/containment/inventory/link/descriptor-byte/digest/manifest proof.
    It returns original verified bytes and permits installed pnpm shims only at
    the explicit build-input boundary. Runtime and delivery allow no shim exception.
- `server-launch.ts` owns `captureOfficialServerEnvironment`,
    `buildOfficialLaunchArguments` and `resolveVerifiedOfficialServerBin`: actual
    invocation-time environment/platform defaults, separate child snapshot and
    explicit per-call verified public-bin resolution. It consumes the complete
    package proof and forwards supplied composition inputs without copying them.
- `AGENTS.md` preserves pure sibling rules, exact filesystem/default capabilities,
    original getter/order behavior and before-use lifecycle/launch triggers.

Core and bridge retain their original default/capture/await timing; the launch
owner introduces no combined preflight or new snapshot boundary. `adapters/file-evidence.ts` retains the descriptor-pinned
regular-file reader shared with fingerprint verification. `tool-catalog.ts`,
`mcp-bridge.ts` and the HTTP handler retain their actual catalog, child/disposal
and originating continuation transactions until complete later ownership cuts.
