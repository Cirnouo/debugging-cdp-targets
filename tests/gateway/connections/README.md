# Managed connection, construction and directory contracts

- `cleanup.test.ts` retains three whole closing/failed-admission and peer-cleanup cases.
- `roots-admission.test.ts` retains eight roots cancel/cleanup, SDK reverse-request,
    unnegotiated/failure and pre-roots snapshot/copy/privacy cases.
- `scoped-restart.test.ts` retains seven immutable snapshot/transfer, failed repair
    and side-specific generation cases.
- `execution-detachment.test.ts` retains six original forms/progress, busy-detach,
    late failure and actual-exit cases.
- `registration-administration.test.ts` retains three authorization/idle-time,
    public-ID administration and immutable operation ownership cases.
- `connection-options.test.ts` retains the whole HTTP/catalog/stale-route case and
    four supplied workspace cases, with their original inner matrices.
- `construction-cleanup.test.ts` retains three whole construction capability,
    pending/late acquisition and retry cases over the actual Core.
- `gateway-cleanup.test.ts` retains seven whole shutdown, rollback, retained
    disposal and catalog cleanup cases, using core-runtime.ts support.
- `directory-lifetime.test.ts` retains twenty cases for connection leases across
    restart, pending/late acquisition, successor holds, actual app exit, descendant
    resource users, external occupancy, observation failure and cleanup retry.
- `directory-operation-evidence.test.ts` retains five cases for acquired-directory
    failure evidence, summary privacy, idempotent terminal results and failed/
    cancelled start metadata after later cleanup.

Together with the two `targets/directory-admission.test.ts` cases, these retain all
27 original connection-isolation cases and inner assertions/cleanup. They share
the real Core/DataDirectoryRegistry setup in
[connection-directory-runtime.ts](../../fixtures/connection-directory-runtime.ts),
with controlled host/router/official I/O. No real target or GUI is launched.
Construction and Gateway cleanup share the real Core composition and controlled
I/O in [core-runtime.ts](../../fixtures/gateway/core-runtime.ts), retaining setup/status
assertions and cleanup branches. No fixture contains regression-case bodies.
The six suites contain 32 expanded cases, including 27 existing cases and five
new cases. The 127 assertion calls in source include every original assertion.
The managed fixture, bounded wait and original Core fixture exports share
`gateway/core-runtime.ts`.
Both default and coverage commands explicitly select all ten suites once.
