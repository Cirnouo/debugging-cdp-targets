# MCP initialization instructions implementation plan

## Goal and constraints

Add standard MCP initialize instructions so hosts can discover the gateway's
purpose and entry workflow. Preserve serverInfo, capabilities, tool contracts,
Skill fields and shared Skill bytes. Version 0.1.0 remains unreleased.
The primary research and field decisions belong in [host metadata](../../host-metadata.md).

Use Node 24.21.0 and pnpm 12.4.2. Work from the latest remote main in an
independent worktree on `feat/mcp-instructions`. Subagents use gpt-6.1-sol;
review and decision agents use Ultra reasoning. Complete trusted installation,
real Git hook initialization and SSH 30/3 verification before delivery.

## Production text

Return this fixed paragraph through the official SDK Server options:

> Use this gateway to inspect local Chrome browsers or other verified CDP-capable applications with official Chrome DevTools tools. Start with dct_connection_status({}) to discover entryId and connection summaries. dct_connection_start launches a new application for each target connection; never take over an existing application. Before preparing a launch, follow the debugging-cdp-targets Skill for isolation choices (including none), occupancy checks, verified startup and readiness. Route every official tool call with the selected connection's current connectionId and sessionId in _dct. Before ending a target's work, obtain Close or Keep unless the user already supplied that choice.

The text is 689 UTF-8 bytes and must stay below 1,000 bytes for the researched
Codex Plugin consumer. It supplements, rather than replaces, the full Skill.

## Atomic tasks

1. `docs(governance): record skill and MCP metadata decisions`: record the
    researched defaults, consumers, adopted/pending decisions, omissions and
    evidence limits. Include the current Desktop Skill-card default-prompt
    prefill consumer. Save this plan as a standalone execution reference.
2. `feat(devtools): add gateway initialization instructions`: first add and
    observe failing production-adapter protocol assertions, then return the
    exact text. Preserve name/version, tools capability, protocol compatibility
    and catalog. Regenerate both host distributions; update implementation state
    and a meaningful Unreleased entry.
3. `test(testing): verify host consumption of MCP instructions`: add a common
    target-free fixture using the production adapter, independent opt-in Codex
    and Claude smokes, required narrow helper changes, smoke instructions and
    actual dated evidence in the primary research record.

## Acceptance

- The protocol response returns the exact production text, critical workflow
    constraints and fewer than 1,000 UTF-8 bytes. Existing identity, capabilities,
    protocol compatibility and lifecycle catalog remain covered.
- The common fixture imports no runtime, router or upstream and has no lifecycle
    dispatch. Official calls fail closed. It obtains instructions from the
    production adapter, never a separate sentinel or copied test description.
- Codex installs a temporary Plugin using that fixture, captures the actual
    loopback model request, returns a controlled `tool_search_call`, and checks
    the subsequent namespace/search description before returning final text.
- Claude installs a temporary Plugin using that fixture. Only this smoke's
    child enables `ENABLE_TOOL_SEARCH=true`, `MCP_CONNECTION_NONBLOCKING=0` and
    the built-in ToolSearch tool. Its first actual loopback request must expose
    deferred discovery and the complete production text in system/search
    metadata. The substitute model returns final text without executing search.
- Validate semantic JSON locations, not a string search over the whole request.
    Do not put the instructions into the test's user prompt. Retain raw requests,
    actual host versions, tested revision, metadata locations and failure evidence.
    No lifecycle MCP call, target application or official upstream is launched.
- These tests establish host consumption, not real-model adherence or automatic
    Skill matching. Claude search execution and Desktop rendering are outside
    this acceptance. Keep historical host smoke and manual UI evidence bounded
    to its original date/version/surface.
- New commands: `node tests/smoke/codex-instructions.ts [codex-executable]` and
    `node tests/smoke/claude-instructions.ts [claude-executable]`. Existing smoke
    defaults remain unchanged. A consumption failure requires diagnosis and
    retained evidence, never manual injection or weakened assertions.

## Verification and delivery

Run focused bridge/lifecycle tests, both new host smokes, regressions affected
by helper changes and each host's existing Skill smoke. Complete `pnpm typecheck`,
`pnpm build:plugin`, `pnpm check:build`, `pnpm check:security` and full
`pnpm verify:push`. Inspect the final diff for the declared scope.

Push, create and attach one PR using the current template and real evidence.
After review and current-head CI pass, merge into remote main, confirm merge
commit CI, then archive the worktree while retaining the PR attachment.

No root README, host manifest, icon, shared Skill, dependency or CI workflow
change is planned. Do not update personal installations/configuration, global
Skills or old state. Do not publish, tag or require manual Desktop acceptance.
