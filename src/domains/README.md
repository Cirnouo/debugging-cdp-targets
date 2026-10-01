# Pure domain rules

- `launch-command.ts` tokenizes templates, expands provided variables, and
  checks port-source conflicts without executing a shell.
- `cdp-target.ts` selects candidates and validates listener/endpoint identity.
- `control-contract.ts` owns command/result unions and validates IPC envelopes.
- `AGENTS.md` restricts this layer to deterministic rules.
