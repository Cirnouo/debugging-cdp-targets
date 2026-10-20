# Official supplied rules and package-file proof

- `options.ts` owns reviewed public flags, parsing/recipes and deterministic
    `buildOfficialServerArguments` with explicit URL/environment/args/platform.
- `execution.ts` owns exact supplied wire identity and once-only terminal values.
- `release-evidence.ts` validates complete reviewed release and manifest evidence.
- `package-files.ts` owns `verifyOfficialPackageFiles`: the complete filesystem
    evidence/root/containment/inventory/link/descriptor-byte/digest/manifest proof.
    It returns original verified bytes and permits installed pnpm shims only at
    the explicit build-input boundary. Runtime and delivery allow no shim exception.
- `AGENTS.md` preserves pure sibling rules, exact filesystem capabilities,
    original getter/order behavior and before-use lifecycle/launch triggers.

The current `adapters/official-server.ts` retains actual invocation-time defaults,
child environment capture and verified public-bin resolution. Its effectful entry
calls the pure composition owner without copying supplied values. Core and bridge
call timing is unchanged. `adapters/file-evidence.ts` retains the descriptor-pinned
regular-file reader shared with fingerprint verification. `tool-catalog.ts`,
`mcp-bridge.ts` and the HTTP handler retain their actual catalog, child/disposal
and originating continuation transactions until complete later ownership cuts.
