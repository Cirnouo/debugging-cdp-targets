# Target lifecycle, value and endpoint admission regressions

- `port-and-endpoint-admission.test.ts` preserves supplied endpoint/product,
    foreign listener, exposed listener and wrong-port identity checks.
- `chrome-profile-argument.test.ts` keeps two pure canonical/native profile
    argument cases and their platform, terminator and whitespace matrices.
- `data-isolation.test.ts` keeps two pure selection/cleanup parser cases.
- `structured-launch.test.ts` keeps ten literal argv/environment/port cases,
    immutable preparation and opaque once-only directory binding.
- `chromium-features.test.ts` keeps twenty pure screenshot composition cases,
    including native whitespace, ASCII grammar and positional-boundary matrices.
- `chrome-profile.test.ts` keeps eight controlled target-host profile cases:
    canonical binding, occupancy, peer claims, cancellation and actual-exit release.
- `chrome-launch.test.ts` keeps seventeen controlled preset/launch cases,
    exact recovery, pre-spawn conflict/port release and non-Windows restoration.
- `directory-admission.test.ts` keeps two real Core pre-acquisition cases:
    missing binding/invalid official options and already-cancelled startup without
    evidence or filesystem effects. It shares `fixtures/connection-directory-runtime.ts`
    with the connection suites, separately from the target-host fixture.

- `target-lifecycle.test.ts` keeps nine complete Keep/Close, actual-exit,
    restart/health, explicit owner-cleanup, busy-router and attachment cases.
- `lifecycle-rollback.test.ts` keeps three complete attachment/replacement and
    typed retained-target rollback cases, without serializing launch evidence.
- `observer-cleanup.test.ts` keeps both observer/profile cases through failed
    Close, explicit owner cleanup and actual-exit release.
- `close-diagnostics.test.ts` keeps the complete native-details/retry identity
    case through operation results. These four suites conserve fifteen callbacks
    and their original fixtures; plugin-runtime retains its eleven other cases.

Both default and coverage commands explicitly select all twelve suites once, with
file concurrency 1. The six value suites conserve all 59 original registrations,
inner assertions and cleanup. Both runtime suites share the controlled
[target host fixture](../../fixtures/target-host.ts); no real target launches.
The two candidate-chooser cases remain in root plugin-runtime.test.ts, including
reserved ranges, order, privileged-port floor and exhaustion. Mutable ownership
and actual claim-before-await lifetime remain at their current runtime owners.
