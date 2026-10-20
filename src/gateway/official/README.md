# Official supplied-value rules

- `options.ts` owns reviewed public flags, parsing/recipes and deterministic
    `buildOfficialServerArguments` with explicit URL/environment/args/platform.
- `execution.ts` owns exact supplied wire identity and once-only terminal values.
- `release-evidence.ts` validates complete reviewed release and manifest evidence.
- `AGENTS.md` preserves purity, original getter/order behavior and before-use
    triggers for any later launch, child/catalog or continuation ownership cut.

The current `adapters/official-server.ts` retains actual invocation-time defaults,
child environment capture and verified public-bin resolution. Its effectful entry
calls the pure composition owner without copying supplied values. Core and bridge
call timing is unchanged. `adapters/official-package.ts` retains complete filesystem
verification; `tool-catalog.ts`, `mcp-bridge.ts` and the HTTP handler retain their
actual catalog, child/disposal and originating continuation transactions. Their
complete final placement and the mixed package/TEMP test split remain later work.
