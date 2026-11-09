# Host plugin regressions

- `payload-integrity.test.ts` checks literal byte maps, endpoint evidence and
    overlays, including real import isolation from a temporary working directory.
- `payload-filesystem.test.ts` checks actual disposable file trees, links, Claude
    leases and the complete atomic endpoint write/readback transaction.
- `user-intent.test.ts` checks standard TOML/JSON forms, strict own source/ref/
    enablement projection, privacy and pinned/ambiguous refusal.

All three suites run once in the explicit default and coverage lanes. These controlled
regressions do not establish native host, browser, App or GUI acceptance.
