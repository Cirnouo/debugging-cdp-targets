# Gateway target lifecycle and models

- `model/` owns pure endpoint identity validation and supplied target/resource
    contracts, profile argument and screenshot composition, isolation intent and
    structured launch values; its local map describes the six delivered owners.
- `target-lifecycle.ts` exports createTargetLifecycle, TargetLifecycleHost,
    TargetLifecycleRouter, TargetExitEvent, TargetHealth and TargetLaunchContext.
    One closure owns attachment, admission, health coalescing, normal-Close reuse,
    rollback, actual-exit callbacks and retirement. Managed connection and registry
    invoke its cleanup explicitly. Agent/MCP disconnect does not request cleanup.
- `AGENTS.md` bounds that exact mutable role, keeps model/ and unknown files pure,
    and triggers the complete canonical lifecycle obligations before editing.

The existing adapters acquire and verify actual targets. Start admission creates
the lifecycle through supplied host/router capabilities. Managed connection
retains connection generations and execution. Registry retains route membership
and cleanup retries and consumes only the exit event TYPE.
Domain `cdp-target.ts` still contains PortRange
and the standalone candidate chooser. This slice does not complete target or
port-lifetime reorganization.
