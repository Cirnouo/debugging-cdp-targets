# Pure domain rules

- `app-restart.ts` validates the bounded private restart context and exact
  successor lease ACK. Syntax grants no file ownership or native lease proof.
- `app-deployment.ts` strictly validates initial physical installation metadata,
  complete immutable selection identifiers and active/removing/removed transitions.
  Its canonical payload inventory includes all directories/files and contained
  Darwin framework links, with exact OS, architecture and executable bits.
  Deterministic native identity/permission predicates validate supplied facts
  without issuing native authority.
  It grants no payload-verification, permission, enrollment or deletion authority.
- `app-release.ts` validates independently maintained Electron, ordinary Node
  and complete native loader release evidence.
- `mcp-http.ts` validates exact loopback HTTP endpoint/body headers and the
  iterative whole-JSON member/depth budgets without reflecting secret inputs.
  Explicit bearer/tool-argument extraction belongs to
  `gateway/owned-tool-arguments.ts`.
- `request-failure.ts` owns closed, path-free explanations for authenticated
  busy and originating-client facility failures across the HTTP boundary.
- `host-management.ts` validates the one latest stable plugin record and the
    effective loopback endpoint, and decides compatibility without downgrade or
    release-history lookup. No production stable record is advertised.
- `software-version.ts` owns strict node-semver parsing and precedence comparison
    for runtime decisions and the tooling facade; exact version-group agreement
    remains a tooling responsibility.
- `cdp-target.ts` retains PortRange and the standalone candidate chooser with
    caller-supplied reserved ranges/probes. PortRange serves the native adapter;
    choosePort has two test cases and no production caller. Supplied endpoint/
    listener identity and target/resource contracts now belong to
    `gateway/targets/model/`. Actual claim-before-await admission and claim
    lifetime remain in the target host; this port residue is still unfinished.
- `control-contract.ts` owns MCP lifecycle request/result unions, identities and
  pure diagnostic phase/outcome/elapsed value types and callback signature.
- `AGENTS.md` restricts this layer to deterministic rules.

The accepted [isolation design](../../docs/adr/0015-explicit-data-directory-isolation.md)
adds pure required start intent, existing/new selection and cleanup validation,
plus opaque {dataDir} binding in structured args/env, now owned by
[gateway/targets/model/](../gateway/targets/model/README.md). control-contract.ts
consumes its parsers and value types. Desktop snapshot isolation evidence TYPEs
belong to [desktop/contracts/snapshots.ts](../desktop/contracts/snapshots.ts).
Only the exact isolation.ts and launch-command.ts target dependencies are permitted
from this layer. Closed management contracts, fixed asset admission and supplied
elapsed formatting belong to [desktop/](../desktop/README.md). No domain consumes
Desktop configuration or its store. Filesystem and application support
evidence comes from callers/adapters.
