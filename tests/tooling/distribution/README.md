# Thin-payload build regressions

`thin-plugin-payloads.test.ts` retains six complete payload scenarios: nested output
synchronization and read-only refusal, literal complete Codex bytes, competing or
missing/renamed shared inputs, linked roots, installed documentation and independent
App/plugin versions. Assembly uses the actual remaining root tooling APIs.

Both safe test commands select this suite once. Host runtime filesystem/integrity
regressions retain their separate owners. Cumulative [test rules](../../AGENTS.md) apply.
