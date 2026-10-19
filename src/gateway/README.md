# Gateway arguments, target models and diagnostics

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
    Target acquisition, claims, observation and cleanup stay with current owners.
- `AGENTS.md` keeps argument and target rules pure and limits the exact diagnostics owner
    to its clock read and pure contract dependency.

The HTTP server still consumes admission from `domains/mcp-http.ts`; the
request handler consumes these parsers before real Core authentication. This
owner holds no registration, live-route, continuation, execution or resource
state. The remaining runtime keeps its current technical-layer placement.
The complete lifecycle-contract path and symbol migration remains pending until
the actual App UI and CDP domain consumers move with it.
