# Host plugin regressions

- `payload-integrity.test.ts` checks literal byte maps, endpoint evidence and
    overlays, including real import isolation from a temporary working directory.
- `payload-filesystem.test.ts` checks actual disposable file trees, links, Claude
    leases and the complete atomic endpoint write/readback transaction.

Both suites run once in the explicit default and coverage lanes. These controlled
regressions do not establish native host, browser, App or GUI acceptance.
