# Native advisory locking

- [advisory-lock.ts](advisory-lock.ts) verifies the complete original native
    package closure without loading it. The separate production loader admits
    Windows x64 and arm64 before verification and then loads the original public
    shared/exclusive lock operation. Callers without a shared option use
    exclusive mode.
- [AGENTS.md](AGENTS.md) defines the exact role and consumers.

[App Main](../../interface/README.md) loads the capability. The
[Desktop singleton](../../desktop/instance/README.md) and
[deployment lease owner](../../adapters/README.md) use its erased contract.
