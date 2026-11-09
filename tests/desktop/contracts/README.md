# Closed management contract regressions

- [commands.test.ts](commands.test.ts) retains both complete scoped-route and
    bounded named-action/settings cases and their invalid command/envelope matrices.
- [snapshots.test.ts](snapshots.test.ts) retains all five complete configuration,
    startup/failure, identity/privacy, pending-session and selected-operation cases.

The supplied validators live in [src/desktop/contracts/](../../../src/desktop/contracts/README.md).
Root lifecycle/management/window/rendering suites retain their real controlled-I/O
fixtures and cleanup; these pure cases add no GUI/native acceptance.
