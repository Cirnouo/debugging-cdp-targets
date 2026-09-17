# Contributor entry point

Use four spaces, never tabs, and LF for maintained source, configuration, and
documentation. Read only the domain you are changing after this index; a nearer
`AGENTS.md` overrides this file for its directory.

## Commands

- Focused runtime tests: `node --test tests/cdp-session.test.mjs`
- Coverage gate: `node --experimental-test-coverage --test-coverage-lines=52 --test-coverage-branches=71 --test-coverage-functions=61 --test tests/cdp-session.test.mjs`
- Skill validation: `python -X utf8 %USERPROFILE%\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\debugging-cdp-targets`

Task 3 introduces package scripts, hooks, CI, and repository validators. Until
then, use the direct commands above.

## Non-negotiable boundaries

- Preserve one managed session per Windows user, fixed LOCALAPPDATA state,
  loopback-only CDP, process/listener/endpoint/daemon identity validation, and a
  required Close/Keep disposition.
- Never attach to, replace, force-kill, or silently clean up a pre-existing or
  identity-mismatched target. Never auto-start a replacement after disappearance.
- Keep `scripts/cdp-session.mjs` as the only public entry. `chrome` and
  `generic-cdp` are the only adapters; PWA mode remains rejected. Do not claim
  universal Tauri/WebView2 support.
- Do not persist sensitive inputs or outputs. Keep usage statistics and CrUX
  disabled.
- Do not push, tag, publish, modify remotes, or create releases without an
  explicit request.

## Context map

- [Glossary](CONTEXT.md)
- [Repository policies](docs/policies/README.md)
- [Architecture decisions](docs/adr/README.md)
- [Installable Skill](skills/debugging-cdp-targets/SKILL.md)
- [Runtime source map](skills/debugging-cdp-targets/scripts/README.md)
- [Tests](tests/README.md)
- [Tooling and quality policy](docs/policies/quality.md)
