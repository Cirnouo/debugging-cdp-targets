# Construction, Gateway cleanup and directory lifetime

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
I/O in [core-runtime.ts](../../fixtures/core-runtime.ts), retaining setup/status
assertions and cleanup branches. No fixture contains regression-case bodies.
Both default and coverage commands explicitly select all four suites once.
