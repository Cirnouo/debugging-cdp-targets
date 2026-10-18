# Claude Code peer distribution implementation plan

The user approved this plan in chat on 2026-10-05. Implement it in the primary
checkout on `codex/claude-code-distribution`, without creating a worktree.

## Goal and constraints

Deliver independent, complete Codex and Claude Code Plugins from one maintained
runtime, shared Skill instructions and reviewed official Server release.

- Use Node 24.21.0 and pnpm 12.4.2. Keep 0.1.0 unreleased.
- Use four spaces, UTF-8, LF and no tabs. Preserve unrelated changes.
- Keep current official release/catalog evidence, dependencies and both locks.
- Keep seven MCP lifecycle tools, official tool names/results and `_dct` routing.
- Preserve independent connections, verified launches, explicit Close/Keep,
  scoped normal shutdown, quarantine and explicit recovery.
- Do not add persistent session state, a Plugin CLI or dedicated control IPC.
- Run isolated host acceptance with temporary configuration and synthetic data.
- All implementer/reviewer subagents use `gpt-6.1-sol`.
- The user authorizes atomic commits, final branch push, CI monitoring and the
  GitHub description update. Tags, publication, PRs, merge and Ruleset changes
  are outside this task.

## Architecture

`src/` stays the shared runtime. `packaging/shared/` owns complete host-neutral
Skill instructions and shared distribution documentation. `packaging/codex/`
and `packaging/claude-code/` own host manifests, MCP/Hook definitions and user
documentation. The complete committed installation outputs are
`plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/`.

Build the shared runtime once and assemble both outputs from explicit input
trees without a generic templating framework. Root LICENSE is canonical.
Shared skills, licenses, runtime helpers/notices and official Server bytes must
match in both outputs. No output depends on a sibling or repository dependency.
Remove the old payload path while retaining plugin and marketplace identities.

Pure host/root metadata is separate from release-backed inventory construction:
the standalone lockfile security preflight must not read release evidence as an
import side effect. All audits remain fail closed; build check is read-only.

Codex retains its explicit `.codex-plugin` MCP/Hook paths and relative argv/cwd.
Claude uses `.claude-plugin/plugin.json`, default `.mcp.json` and Hooks/Skill
discovery. Its Node argv uses `${CLAUDE_PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`,
without Codex cwd/interface fields. Claude Hooks select
`plugin:debugging-cdp-targets:cdp-targets`, retain the four events and three-second
timeout, and call existing status. Do not explicitly re-declare default Hooks
in the Claude manifest. The first supported/tested Claude version is 2.1.283.

## Task 1: Separate packaging inputs from Codex payload

Commit: `refactor(distribution): separate packaging inputs from codex payload`.

Test the new canonical packaging and Codex destination before implementation.
Move maintained packaging inputs out of the installable tree, introduce pure
host descriptors, and assemble a complete Codex output at its new path. Update
the existing Marketplace pointer and all affected runtime development fallback,
build/audit/security/release/format/smoke/test paths atomically. Regenerate the
runtime and standalone security output. Keep source metadata independent from
generated output. Add immediate directory documentation and include this plan.

Acceptance: focused build/distribution/repository/security/release tests,
typecheck, full tests and read-only build/distribution/repository checks pass.
Standalone lockfile preflight still works without dependencies/release evidence.

## Task 2: Add Claude Code distribution

Commit: `feat(distribution): add claude code plugin distribution`.

Test second-host inventory, manifest/MCP/Hook validation, Marketplace routing,
metadata agreement and security fingerprints before implementation. Add the
Claude packaging tree and repository Marketplace. Assemble both independent
outputs with one shared runtime build. Verify each complete unchanged official
release and identical shared bytes independently. Audits reject malformed,
missing, extra, duplicate, symlinked and escaped content, wrong-host metadata,
wrong Marketplace routing and either host's version/license drift. Release
metadata failures must occur before remote publication activity. Security binds
all bytes in both official subtrees and both root Marketplace configurations.
Make lifecycle descriptions and the common Skill host-neutral.

Acceptance: focused tests, full tests, typecheck and both generated checks pass.
Copy each output outside repository dependencies and initialize from arbitrary
cwd, verifying official/gateway catalog, empty status and missing-route rejection.

## Task 3: Verify real Claude loading and Hooks

Commit: `test(distribution): verify claude code loading and hooks`.

Add opt-in actual-Claude Marketplace install/discovery and model-context smoke.
Use disposable config/home/workspace/Marketplace, sanitized credentials/provider
environment, a synthetic API key and loopback Anthropic SSE model substitute.
Check actual plugin validation, installed source bytes and component inventory.
Use the existing gateway I/O fixture for PreToolUse/PostToolUse/UserPromptSubmit,
one Stop continuation, lifecycle result delivery, next-turn idle notices and
disabled-Hooks negatives. Discover/invoke the namespaced Skill and inspect real
outbound model context. Test isolation helpers/response handling before adding
their behavior; do not treat direct gateway execution as host discovery.
Keep smokes opt-in and existing CI names/Chrome acceptance intact.

Acceptance: actual Claude 2.1.283 and actual Codex install/discovery/Hook smokes
pass with temporary state only; shared runtime regressions pass.

## Task 4: Document and deliver both hosts

Commit: `docs(distribution): document codex and claude code support`.

Update root user documentation with peer requirements/install/update/uninstall
and invocation instructions. Document each host's actual Hook trust behavior;
Claude enabled/disabled differs from Codex installed/untrusted. Update directory
navigation, current policies/terms, an ADR, Unreleased initial capabilities and
bug reports to collect host/version. Preserve historical ADR evidence.

Before the last commit, regenerate both Plugins and standalone security checker,
run host smokes, `pnpm check:security` and `pnpm verify:push`; review staged diff.
After all commits, push this branch and monitor CI/CodeQL for exact final SHA.
Fix failures with coherent commits and re-run until checks pass. Then update
and read back the GitHub description:

> Launch and inspect verified local CDP targets in Codex and Claude Code using the official Chrome DevTools MCP Server.

Report commit identities, pushed branch, CI links/results, actual host acceptance
versions and description confirmation. No publication or merge.
