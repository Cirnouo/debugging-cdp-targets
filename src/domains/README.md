# Pure domain rules

- `launch-command.mjs` tokenizes templates, expands provided variables, and
  checks port-source conflicts without executing a shell.
- `cdp-target.mjs` selects candidates and validates listener/endpoint identity.
- `AGENTS.md` restricts this layer to deterministic rules.
