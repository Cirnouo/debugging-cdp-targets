# Target lifecycle and supplied model boundaries

Apply root, [source](../../AGENTS.md) and [Gateway](../AGENTS.md) instructions
cumulatively. BEFORE editing target-lifecycle.ts, read all canonical
[application lifecycle obligations](../../application/AGENTS.md), including
ownership before acquisition, admission, actual exit, cleanup, cancellation and
directory isolation. This instruction trigger also governs changes to its ports.

target-lifecycle.ts owns the complete existing target attachment, admission,
health coalescing, normal-Close request reuse, rollback, actual-exit notification
and retirement transaction. Keep its state and closures together; no second
cleanup ledger, state bag, replay or automatic restart. Explicit owner cleanup is
not triggered by Agent/MCP transport disconnect. Preserve the existing cleanup
expected-exit default and diagnostic values.

This exact role admits named randomUUID from node:crypto, emitFixtureEvent from
../../adapters/fixture-diagnostics.ts, createResourceOwner and ResourceOwner TYPE
from ../connections/resource-owner.ts, RetainedTargetError and ManagedTarget TYPE
from ./model/target-contract.ts, and DetailedError/errorCode/errorDetails/errorMessage
from ../../shared/errors.ts. Its only control-contract dependencies are the TYPES
ControlContext, Disposition, LaunchContext, LaunchOptions and TargetStatus from
../../domains/control-contract.ts. Keep those exact relative named/type bindings.
Only the existing direct new Date().toISOString() exit timestamp is permitted;
no other clock, process/env/argv, filesystem, network, SDK, native or kill authority.
Core consumes only createTargetLifecycle and TargetLifecycleHost/TargetLifecycleRouter
types; registry consumes only TargetExitEvent TYPE. Pure owners and adapters
cannot import this mutable lifecycle, including erased or computed forms.

model/ remains pure. Launch/isolation and native argument rules consume supplied
values. Endpoint identity consumes supplied evidence; resource contracts describe
capabilities and retained ownership without acquiring them. Unknown target files
remain pure and gain none of the exact lifecycle role's capabilities.

Keep port claims, actual launch acquisition/native observation and profile release
with their adapters. Preserve the claim before the first probe await and the
existing ownership/cleanup transaction at its actual caller; do not replace it
with the standalone domain port chooser. Actual target exit is distinct from
helper, observer or transport completion. Describing a handle grants no new
authority to acquire or terminate a target.

Before adding another target responsibility or changing these boundaries, follow
the parent Gateway organization/disclosure review and runtime-source audit rules.
