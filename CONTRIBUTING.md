# Contributing

Bug reports, documentation improvements, and focused code contributions are
welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report suspected
vulnerabilities through the private channel in [SECURITY.md](SECURITY.md).

## Prepare a checkout

Fork the repository and clone your fork. Install Node 24.21.0 and pnpm 12.4.2;
the versions are also declared in mise.toml. From the repository root, validate
the locked dependencies before installation:

```powershell
node tooling/security/dist/check-security.mjs --phase lockfile --root .
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:security
pnpm install --frozen-lockfile
```

The security checks require the public npm registry and network access. Review
the [supply-chain policy](docs/policies/supply-chain.md) if a check fails. Do not
repair the lock automatically or bypass installation trust. The ordinary
installation enables the reviewed build script and prepares local Git hooks.

## Make a focused change

Start with [AGENTS.md](AGENTS.md), the nearest source AGENTS.md, and the policies
relevant to your change. These files remain the authoritative contributor rules.
See [source ownership](src/README.md), [tests](tests/README.md), and
[tooling](tooling/README.md) for navigation.

Create a topic branch allowed by the [branch and commit policy](docs/policies/commits-and-scope.md),
for example `fix/describe-the-problem`. Discuss a substantial design or behavior
change in an issue before investing in its implementation. Preserve unrelated
work and add a failing regression test before changing behavior.

Run the affected tests first, followed by the complete local verification:

```powershell
node --test tests/target-recovery.test.ts
pnpm verify:push
```

Choose the focused test appropriate to your change. Dependency and build-input
changes also require `pnpm check:security`. When runtime source changes,
regenerate the committed distribution with `pnpm build:plugin`, then verify it
with `pnpm check:build` and the complete verification suite.

Real browser integration is separate from ordinary tests. Follow
[the smoke instructions](tests/smoke/README.md); use only newly launched isolated
targets and agree to normal Close cleanup before running them.

## Submit a pull request

Target main and use a PR title accepted by the commit policy, for example
`fix(target): reject stale session identity`. Explain the problem, final behavior,
and actual verification results in the PR template. Update relevant documentation
and meaningful user-facing changes in the Unreleased changelog.
Wrap description paragraphs and list continuations within 100 characters; CI
validates the complete future squash message as well as its title.

The main Ruleset requires an up-to-date PR and successful required GitHub checks.
The maintainer reviews contributions and merges with squash; the PR title becomes
the commit title. Current single-maintainer settings require no additional
approving reviewer. Local Git hooks complement the remote checks.

Keep version 0.1.0 unreleased. Pushing, creating releases or tags, and changing
repository or user configuration require the authorization described in
AGENTS.md and the [release policy](docs/policies/releases.md).

Maintained packaging inputs live in `packaging/codex/`, `packaging/claude-code/`
and `packaging/shared/`.
Edit those inputs or `src/`, then run `pnpm build:plugin` to regenerate the complete
`plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/` payloads. Root `LICENSE` is canonical;
`pnpm check:build` compares every generated payload file without writing.

The host-specific manifest and default component paths follow their respective
host interfaces. The separate input/output trees are this repository's maintenance
convention, recorded in [ADR 0012](docs/adr/0012-peer-host-distributions.md).
Both hosts share one runtime build, complete Skill and official release evidence.
Each delivered payload must work independently outside repository dependencies.
Run the explicit Codex and Claude Marketplace/Hook smokes after changing host
configuration; ordinary tests and CI keep real host invocations opt-in.
