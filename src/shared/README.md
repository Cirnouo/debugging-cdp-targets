# Shared invariants

- `constants.ts` owns cross-layer limits, target kinds, disposition values,
  loopback defaults, and the exact official Server package version.
- `AGENTS.md` prevents this layer from becoming an unowned utility collection.
- `errors.ts` owns validated unknown-value guards and structured error details.
- `diagnostics.ts` defines phase/outcome/elapsed metadata and one-shot timing.
- `official-package.ts` validates reviewed release evidence and package identity without I/O.
