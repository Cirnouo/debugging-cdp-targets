# Pure domain rules

- `official-execution.ts` tracks one matching wire identity until real response/close.
- `app-configuration.ts` owns schema 2, the real schema 1 migration, validated
  explicit host selections and desired/effective hot/cold settings. Unpublished
  pre-schema-1 formats have no production migration promise.
- `app-release.ts` validates independently maintained Electron, ordinary Node
  and complete native loader release evidence.
- `app-ui.ts` validates the fixed local asset routes and narrow management
  requests/snapshots, selected explicit configuration, unbounded elapsed clocks
  and startup failure without invented settings.
- `mcp-http.ts` validates the exact loopback HTTP endpoint/body headers and
  explicit per-request registration routing without reflecting secret inputs.
- `request-failure.ts` owns closed, path-free explanations for authenticated
  busy and originating-client facility failures across the HTTP boundary.
- `host-management.ts` validates the one latest stable plugin record and the
    effective loopback endpoint, and decides compatibility without downgrade or
    release-history lookup. No production stable record is advertised.
- `software-version.ts` owns strict node-semver parsing and precedence comparison
    for runtime decisions and the tooling facade; exact version-group agreement
    remains a tooling responsibility.
- `launch-command.ts` validates structured launches, expands provided variables, and
  checks port-source conflicts without executing a shell.
- `cdp-target.ts` selects candidates and validates listener/endpoint identity.
- `chromium-features.ts` composes the fixed Chrome screenshot feature immutably,
  preserves unrelated ASCII lists and positional args, and rejects ambiguous conflicts.
- `control-contract.ts` owns MCP lifecycle request/result unions and identities.
- `data-isolation.ts` validates required isolation intent, directory operations,
  cleanup policy and typed directory evidence.
- `official-options.ts` validates reviewed official options and complete recipes,
  reserving browser attachment/launch options for the gateway.
- `AGENTS.md` restricts this layer to deterministic rules.

The accepted [isolation design](../../docs/adr/0015-explicit-data-directory-isolation.md)
adds pure required start intent, existing/new selection and cleanup validation,
plus opaque {dataDir} binding in structured args/env. Filesystem and application
support evidence comes from callers/adapters.
