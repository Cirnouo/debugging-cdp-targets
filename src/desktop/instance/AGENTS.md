# Desktop process-instance ownership

Apply root, source and Desktop instructions cumulatively. Before changing
singleton admission, activation, Chromium scratch or their consumers, read
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md) and the
[accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md).
Before editing bootstrap resource ordering, read the cumulative
[bootstrap instructions](../main/AGENTS.md). Before editing advisory-lock
verification/loading, its type or its consumption, read the cumulative
[platform](../../platform/AGENTS.md) and [native](../../platform/native/AGENTS.md)
instructions.

`singleton.ts` owns native-account paths, private directory and descriptor
identity/permission checks, and descriptor retention until actual process exit.
The account namespace is independent of selected App data and environment home
overrides. Keep the existing synchronous admission and losing-descriptor close.
Never unlink or replace the lock file, expire a lease, release early, take over
or call Electron's singleton API. Its exact VALUE dependencies are Node crypto,
filesystem, OS and path plus shared errors. It uses the native AdvisoryLock TYPE
only. Its three direct platform reads are the existing path argument and the
two account permission checks.

`activation.ts` owns the bounded fixed activation request/reply over one local
socket or pipe. Only the winner handles stale socket cleanup and starts the
listener. Preserve the two direct platform branches for stale socket handling
and permissions, the framing/timeout and returned close capability. The channel
carries no management requests, credentials, settings or target commands. Its
exact VALUE dependencies are Node filesystem promises, net and shared errors.

`chromium-storage.ts` owns synchronous per-process temporary Chromium roots,
partial creation rollback and best-effort cleanup. Keep it separate from
persistent configuration and selected App data. Its exact VALUE dependencies
are Node filesystem, filesystem promises, OS and path.

Only current `interface/app-main.ts` consumes singleton and activation VALUEs.
Only the bootstrap consumes Chromium storage VALUE; Main consumes its erased
return shape. Unknown siblings remain pure and dependencyless. Keep ambient
argv, environment, clock and network access outside these roles.
