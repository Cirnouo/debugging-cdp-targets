# Desktop process-instance regressions

- [app-singleton.test.ts](app-singleton.test.ts) checks native-account namespace
    independence, retained descriptors and lock-file identity across attempts.
- [app-activation.test.ts](app-activation.test.ts) checks fixed bounded framing,
    owner-only listening and stream closure after the first complete request.
- [app-chromium-storage.test.ts](app-chromium-storage.test.ts) checks synchronous
    unique roots and independent cleanup.

These default tests use controlled Node fixtures. Their
[source owners](../../../src/desktop/instance/README.md) serve the
[bootstrap](../main/README.md) and root App Main lifecycle tests.
