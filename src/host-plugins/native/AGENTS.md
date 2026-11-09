# Selected Host configuration evidence

Before editing this reader, pure intent or its actual native adapter consumer,
read cumulative [Host instructions](../AGENTS.md),
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md) and the
[accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md).

Only `user-intent-file.ts` may acquire the explicitly selected config.toml or
settings.json. Its VALUE dependencies are `node:fs/promises`, `node:path`,
`../../shared/errors.ts`, `../../adapters/file-evidence.ts` and `../user-intent.ts`;
`../../domains/host-management.ts` is TYPE-only. Only the existing native host
adapter consumes this reader. Unknown native siblings remain pure and I/O-free;
all files retain ambient process, clock, network and CLI guards.

Keep lstat admission, regular/nonlinked/single-link/1MiB limits, descriptor-backed
read, UTF-8 decoding, real parsing and ENOENT-only empty fallback as one operation.
Descriptor identity and close remain in the existing file-evidence adapter.
Expose only bounded invalid-user-settings errors. Add no roots, writes, cache,
retry, injected reader or native command. Command/receipt publication and the
separate synchronization/GUI job barriers retain their current owners and order.
