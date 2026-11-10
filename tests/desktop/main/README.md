# Bootstrap and fixed asset admission regressions

- [app-bootstrap.test.ts](app-bootstrap.test.ts) checks synchronous Chromium
    redirection before Main, entry completion before ready-dependent startup,
    sanitized asynchronous rejection and early unsupported-host refusal.
- [asset-policy.test.ts](asset-policy.test.ts) retains the complete fixed-route,
    authority/method/origin case and all original invalid URL literals.

The [source map](../../../src/desktop/main/README.md) identifies both owners.
The root Main lifecycle, Host and window suites retain their current
[test inventory](../../README.md).
