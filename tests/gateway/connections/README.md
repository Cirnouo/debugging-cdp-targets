# Directory lifetime and explicit operation evidence

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
Both default and coverage commands explicitly select the two suites once.
