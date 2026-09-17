# Architecture decision records

This directory owns accepted, durable architecture decisions.

- `0001-isolated-skill-payload.md` isolates the installable distribution.
- `0002-runtime-architecture.md` selects Node, a thin Windows helper, one public
  entry, and domain-oriented modules.
- `0003-managed-session-state.md` fixes one session in LOCALAPPDATA.
- `0004-target-adapters.md` defines adapter boundaries and rejects a universal
  Tauri claim.

New ADRs use the next four-digit number and record context, decision, and
consequences. Implementation rules remain in local `AGENTS.md` files.
