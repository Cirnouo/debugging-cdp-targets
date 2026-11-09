# Official supplied rules, package-file proof, launch inputs and upstream lifetime

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
- `upstream.ts` owns one actual generation's complete SDK client/transport,
    serialized private catalog publication and admission, actual wire settlement and
    App-owned Server child. It closes the transport before confirming actual exit
    through bounded EOF/TERM/KILL disposal for that child.
- `AGENTS.md` preserves pure sibling rules, exact filesystem/default/upstream capabilities,
    original getter/order behavior and before-use lifecycle/launch triggers.

Managed connection builds arguments for the connection's upstream. Start
admission captures the child environment before roots, validates arguments and
resolves the verified bin at the existing guard. Connection view invokes
unselected defaults at the original discovery branch. The upstream preserves its
original launch boundaries. `adapters/file-evidence.ts` retains the descriptor-pinned
regular-file reader shared with fingerprint verification. `adapters/tool-catalog.ts`
retains fixed reviewed definitions. The HTTP handler retains originating continuation,
and managed connection retains the execution slot and original client facilities.
