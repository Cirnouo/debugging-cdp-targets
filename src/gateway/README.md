# Gateway Core, registry, arguments and connection lifetimes

- `core.ts` owns transport-free dispatch, independent managed connections,
    generation pointers and original official execution facilities. Start, restart,
    stop, admission, workspace policy and projections remain complete transactions.
- `registry.ts` owns route membership, resource/directory enrollment and retained
    cleanup/retry joins with one ledger and definitive barriers. It consumes the
    original Core ManagedConnection type without a runtime cycle or duplicate state.
- `owned-tool-arguments.ts` owns `parseRegistrationBearerArguments` and
    `parseOfficialToolArguments`: syntactic explicit bearer extraction and
    complete removal of official `_dct` routing from the remaining arguments.
    Both accept unknown input and preserve shallow argument values without
    mutating the source. Route syntax stays in `domains/control-contract.ts`.
- `diagnostics.ts` owns the existing one-shot `measured` clock and emits only
    bounded phase/outcome/elapsed metadata through its optional callback. Its
    pure value/callback types remain in `domains/control-contract.ts`.
- `targets/` owns pure supplied-evidence CDP identity, target/resource contracts,
    profile arguments, screenshot feature composition, isolation and structured launch values.
    Its exact `target-lifecycle.ts` owns complete launch attachment, admission,
    health, normal Close, rollback, actual-exit and cleanup orchestration through
    supplied capabilities. Actual target acquisition, native observation and
    filesystem evidence remain with adapters; pure models gain no ambient authority.
- `connections/` owns complete resource-generation retention/disposal and
    connection-level directory-lease barriers through their exact adapter capabilities.
- `official/` owns pure reviewed options/recipes and supplied argument composition,
    wire identity/terminal tracking and strict release evidence, alongside the complete
    filesystem package-file proof and invocation-time defaults, child environment
    capture and verified public-bin resolution under exact five-dependency roles.
    Live catalog, child/wire/disposal and upstream remain with existing adapters;
    see its [current inventory](official/README.md).
- `AGENTS.md` keeps argument and target rules pure and limits the exact diagnostics owner
    to its clock read and pure contract dependency, with exact Core, registry and
    connection, target-lifecycle, package-file and launch-input roles and the mandatory application lifecycle instruction trigger.

The HTTP server still consumes admission from `domains/mcp-http.ts`; the
request handler consumes these parsers before real Core authentication. This
argument owner holds no registration, live-route, continuation or execution state.
Core retains original actual execution facilities; registry joins route membership
and retained cleanup/retry ownership; the two connections owners retain their complete lifetimes.
The target lifecycle remains one complete owner in `targets/target-lifecycle.ts`;
registrations and MCP lifecycle services retain their current application placement
and exact Core/registry dependencies.
The complete lifecycle-contract path and symbol migration remains pending until
the actual App UI and CDP domain consumers move with it.
