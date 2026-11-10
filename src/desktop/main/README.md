# Synchronous bootstrap and fixed management assets

- [bootstrap.ts](bootstrap.ts) admits supported Windows hosts, redirects Chromium
    paths synchronously and observes the asynchronous Main startup result.
- [asset-policy.ts](asset-policy.ts) owns the App URL and fixed supplied URL/method/
    origin admission rules; it performs no resource acquisition.
- [AGENTS.md](AGENTS.md) defines the exact roles and before-use obligations.

App Main lifecycle and management-window composition remain in
[interface/](../../interface/README.md). The bootstrap and asset regressions
live in [tests/desktop/main/](../../../tests/desktop/main/README.md).
