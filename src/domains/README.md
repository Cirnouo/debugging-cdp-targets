# Pure domain rules

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
