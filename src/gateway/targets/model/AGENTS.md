# Pure target evidence and resource contracts

Apply the [target](../AGENTS.md), [Gateway](../../AGENTS.md),
[source](../../../AGENTS.md) and root instructions cumulatively. Keep these
models deterministic with relative Gateway/domain/shared dependencies. They must
not import the Gateway diagnostics clock, including through erased TypeScript,
or read environment, process, filesystem, network or native state.

cdp-identity.ts validates only caller-supplied endpoint, expected port, listener,
process-tree and target-kind evidence. Preserve fail-closed validation order,
loopback and owner checks, browser-level URL grammar and original return values.
It does not discover a listener, reserve a port or acquire a target.

target-contract.ts describes supplied process/listener evidence and existing
managed-resource capabilities. Preserve the single RetainedTargetError constructor,
DetailedError inheritance, existing name behavior and non-enumerable target.
TargetKind and LaunchDefinition remain with their current domain owners. Native
handles, callback implementation, observation, rollback and exit lifetime remain
outside this model; no wrapper, forwarding alias or new mutable owner belongs here.
