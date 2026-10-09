# ADR 0016: Node compatibility and reproducible toolchain baselines

Status: accepted, 2026-10-09. Clarifies the Node version policy in ADR 0006.

## Context

The exact Node 24.21.0 pin predates the native TypeScript migration: commit
`435158a` already declared it before migration commit `371ad72` on 2026-10-01.
It is a reproducible baseline, not evidence that later stable Node 24 releases
are incompatible. Node documents
[stable type stripping since 24.12.0](https://nodejs.org/docs/latest-v24.x/api/typescript.html#type-stripping),
but that feature milestone does not establish the minimum for this repository's
complete runtime, tests, tooling and dependencies.

## Decision

Support stable Node >=24.21.0 <25 and declare `engines.node: "^24.21.0"`.
Retain 24.21.0 as the floor and exact CI/problem-reproduction baseline. Lowering
the floor or supporting another major needs separate compatibility evidence.
Existing installations in the supported range can be used without downgrading.

Keep pnpm exactly 12.4.2 in `packageManager`, both locks and the isolated audit
manifest. pnpm documents that
[package-manager ranges use a different declaration and record resolution in the lock](https://pnpm.io/package_json#devenginespackagemanager).
Floating pnpm would change a reviewed installation/audit input and potentially
lock behavior; it requires the explicit [supply-chain gate](../policies/supply-chain.md).
This decision changes no dependencies, release hashes or downloader controls.

Optional `mise.toml` uses Node `24` and pnpm `12.4.2` for everyday selection,
without a mise lockfile. Per
[mise's resolution rules](https://mise.jdx.dev/dev-tools/versions.html#how-a-request-resolves),
a prefix may reuse an installed match; `mise install node@24` instead resolves
the newest available 24.x without changing configuration. Check `node --version`
before trusted setup and update a selected older Node to meet the floor.

[pnpm rejects incompatible project engines during installation](https://pnpm.io/settings/cli#enginestrict),
but `engines` does not enforce arbitrary direct `node` invocations. Add no
runtime version check or public API. Review Node security updates explicitly;
range support and optional selection do not replace that review.

## Consequences

Contributors can use newer stable Node 24 releases while reproducing failures
on the exact baseline. Repository audit diagnostics distinguish a drifted Node
range from a drifted pnpm pin. Builds retain the Node 24 target and complete
unchanged official Server release. Historical plans and acceptance evidence
remain dated records; current guides own supported requirements.
