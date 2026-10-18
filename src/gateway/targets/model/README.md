# Pure CDP identity and target contracts

- `cdp-identity.ts` owns `validateCdpIdentity` and its private loopback predicate.
    Supplied endpoint, expected port, listeners, process IDs and optional target
    kind produce the verified browser product and browser-level WebSocket URL.
- `target-contract.ts` owns ListenerEvidence, ProcessTarget, RootEvidence,
    ProcessEvidence, ManagedTarget and the single RetainedTargetError constructor.
    These describe evidence and existing resource capabilities without acquiring
    them; retained target evidence stays non-enumerable.
- `AGENTS.md` preserves deterministic evidence validation, original error/return
    behavior and the boundary between descriptions and resource lifetime.

TargetKind and LaunchDefinition remain in their current domain owners. Actual
port reservations, launch, verification I/O, observation, rollback, normal Close
and confirmed-exit release remain with current adapters/application owners.
