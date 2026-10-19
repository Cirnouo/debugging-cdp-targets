# Pure target values, CDP identity and resource contracts

- `cdp-identity.ts` owns `validateCdpIdentity` and its private loopback predicate.
    Supplied endpoint, expected port, listeners, process IDs and optional target
    kind produce the verified browser product and browser-level WebSocket URL.
- `target-contract.ts` owns ListenerEvidence, ProcessTarget, RootEvidence,
    ProcessEvidence, ManagedTarget and the single RetainedTargetError constructor.
    These describe evidence and existing resource capabilities without acquiring
    them; retained target evidence stays non-enumerable.
- `chrome-profile-argument.ts` validates the effective canonical profile switch
    using supplied platform and native argv semantics, without filesystem claims.
- `chromium-features.ts` composes the fixed screenshot feature immutably and
    preserves ASCII feature grammar, native Windows whitespace and positional boundaries.
- `isolation.ts` owns explicit isolation selection/cleanup and supplied directory
    state/evidence types; absolute and filesystem validation remain in adapters.
- `launch-command.ts` parses structured launches, prepares immutable supplied
    environment/port snapshots and binds opaque directory bytes once. It owns
    mergeLaunchEnvironment; shared/environment-key.ts matches supplied keys.
- `AGENTS.md` preserves deterministic evidence validation, original error/return
    behavior and the boundary between descriptions and resource lifetime.

TargetKind remains in domains/control-contract.ts; LaunchDefinition belongs to
launch-command.ts here. Actual
port reservations, launch, verification I/O, observation, rollback, normal Close
and confirmed-exit release remain with current adapters/application owners.
