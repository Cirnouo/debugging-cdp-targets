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
TargetKind remains with its current domain owner; LaunchDefinition belongs to
launch-command.ts here. Native handles, callback implementation, observation, rollback and exit lifetime remain
outside this model; no wrapper, forwarding alias or new mutable owner belongs here.

Launch and isolation rules preserve structured argument boundaries, reject unresolved
variables and conflicting known port sources, and support generic caller-provided
port placeholders. Prepare immutable executable/argv/cwd/environment and port
policy snapshots; never read the host environment. Share only supplied environment
key matching with the Official adapter; merging remains target-owned.

Validate the required none/data-dir union and existing/new operations without I/O.
Preserve operation choice and explicit cleanup policy, and accept directory evidence
as input. Require absolute selections at the adapter boundary before canonical
filesystem acquisition; the selection parser retains its nonblank validation.
Bind {dataDir} only in args/env as opaque path bytes after ordinary expansion;
never re-expand inserted path text. None rejects the placeholder. Do not encode
a location denylist or infer application isolation support from a framework name.

Profile argument and screenshot composition preserve native Windows whitespace,
canonical switches, platform case rules, ordered ASCII feature grammar and exact
positional boundaries. Never mutate caller arrays or replace explicit conflicts.
These models grant no profile lock, port claim, target launch or native authority.
