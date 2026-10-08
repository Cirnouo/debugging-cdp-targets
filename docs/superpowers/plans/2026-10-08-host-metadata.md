# Host metadata completion

Goal: complete useful local-install metadata for Codex and Claude Code, repair
the project website, and require independent metadata research for future hosts.

Architecture: maintain host metadata in packaging inputs; generate complete peer
payloads with the existing pure host descriptors and exact inventories. Shared
Skill instructions and runtime remain common. ADR 0012 owns peer packaging;
ADR 0015 owns the unchanged explicit isolation behavior.

Technology: Node 24.21.0, pnpm 12.4.2, native erasable TypeScript, JSON, YAML,
existing PNG artwork, real host CLI smokes and synthetic loopback models.

## Global constraints

- Distribution is GitHub README/user-guide self-installation. Public-directory
    submission requirements are outside the adopted metadata basis.
- Version 0.1.0 remains unreleased. No publication, tags, dependency upgrades,
    runtime interfaces, new artwork, personal config or global Skill changes.
- Work in an independent managed worktree on `fix/host-metadata`; preserve
    unrelated work. Follow nearest AGENTS and repository policies.
- Four spaces, UTF-8, LF, no tabs. Validators are test-first; verify generated
    output instead of editing it. Each atomic implementation commit includes
    its own relevant tests, audit changes and generated distribution output.
- All subagents use gpt-6.1-sol; review and decision agents use Ultra reasoning.
- Codex-only additions must not overwrite shared instructions. Compare the
    exact shared maintained file set in both payloads, never exempt all skills.
- Use temporary host configuration and local synthetic models for smokes.
    Explicit Skill invocation proves context injection; it does not prove the
    Desktop starter prompt does the same.
- Desktop rendering is a manual pre-merge gate. Record Desktop version, build
    commit and installed source/cache freshness, then check website navigation,
    Skill title/description/icons and actual long-description rendering.
- Push, create and attach one PR, merge after review/acceptance/latest PR CI,
    monitor merged main CI, then archive the worktree while retaining the PR
    attachment. The human has authorized these GitHub actions.

## Task 1: Repair plugin project links and display metadata

Commit: `fix(distribution): complete local plugin project metadata`.

1. Add the common manifest `homepage` in both hosts and Codex
    `interface.websiteURL`, all exactly
    `https://github.com/Cirnouo/debugging-cdp-targets`; retain `repository`.
2. Add Claude `displayName` exactly `Debugging CDP Targets`. Add Codex
    `interface.longDescription` exactly:

    Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.

    Retain this optional field only after actual Desktop display confirmation;
    if it is not rendered, omit it and record that host limitation.
3. Retain existing short descriptions and starter prompt text. Require three
    distinct, nonempty single-line strings, each at most 128 Unicode code
    points. Cover acceptance of 128 non-BMP characters and rejection at 129.
    This corrects the approved plan's publication-only premise: the inspected
    Codex 0.160.0 and actual installed 0.161.0 local loader also drops longer
    prompts. The versioned runtime source, not publication rules, is the basis:
    https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/core-plugins/src/manifest.rs#L533-L551
4. Develop manifest acceptance/negative tests first and observe the expected
    failures. Update exact field/type/value validation, regenerate both
    payloads, run focused tests and relevant checks, then commit owned files.
5. Update immediate packaging documentation for field ownership and the
    verified local-loader prompt constraint.

## Task 2: Add Codex Skill presentation and explicit discovery

Commit: `fix(skill): declare Codex skill presentation and discovery`.

1. Add Codex manifest `skills` exactly `./skills/` and its exact validation.
2. Maintain `packaging/codex/skill-openai.yaml` and
    `packaging/codex/skill-agents-README.md`; map them with existing host.files to
    `skills/debugging-cdp-targets/agents/openai.yaml` and its `README.md`.
3. YAML contains only interface with these values:

    ```yaml
    interface:
        display_name: "Debugging CDP Targets"
        short_description: "Debug verified local CDP targets"
        icon_small: "../../assets/icon.png"
        icon_large: "../../assets/icon.png"
    ```

4. Reuse the existing plugin-root PNG. Codex 0.160.0 PluginShared icon semantics
    permit this relative path; local audit accepts only the approved exact
    path, resolves it within this payload's own assets, verifies regular PNG
    bytes and the approved shared source. Do not extend this traversal rule to
    manifest/MCP/Hook paths or standalone Skills.
5. Use the real YAML parser. Cover malformed YAML, duplicate/unknown fields,
    wrong value types, missing metadata/icons, invalid/escaping icon paths and
    wrong-host additions. Confirm metadata is audited rather than ignored.
6. Derive the shared Skill file set from maintained shared inputs and compare
    every shared file in both hosts. Independently enforce exact Codex overlay
    inventory; Claude must not contain it. Keep shared SKILL.md unchanged.
7. Update immediate ownership/readme documentation, regenerate both payloads,
    run focused tests and relevant checks, then commit owned files.

## Task 3: Verify installed metadata and full Skill context

Commit: `test(testing): verify installed plugin metadata and skill context`.

1. Extend real Codex marketplace smoke using its temporary CODEX_HOME.
    Discover the marketplace path and plugin identity; use plugin/read to check
    returned project/display metadata and bundled components. Use skills/list
    with scoped cwds and forceReload; require no loading errors, correct
    pluginId/enabled/path and exact interface displayName/shortDescription/
    absolute iconSmall/iconLarge. Byte-check the installed payload.
    Codex 0.161.0 resolves this plugin Skill to
    `debugging-cdp-targets:debugging-cdp-targets` with scope `user`; use its
    pluginId and canonical installed path to prove plugin provenance.
2. Extend the synthetic loopback Codex model smoke with production Skill bytes
    and a formal explicit skill input. Inspect actual outgoing model messages
    for complete instructions and the current explicit isolation rules.
    Before model threads, disable all discovered non-fixture Skills through
    skills/config/write in the temporary CODEX_HOME, forceReload, and require
    exactly the intended installed Skill to remain enabled. Windows discovery
    uses the system profile's Known Folder API, so HOME/USERPROFILE overrides
    cannot establish OS-home isolation. Discovery may read global Skill files;
    this strategy isolates temporary configuration and model-visible context
    without modifying those files or personal configuration.
3. Disable the Skill in temporary configuration, refresh discovery, and create
    a new thread for the negative. Verify disabled state and absence of full
    instructions when not explicitly invoked; require no enabled Skills after
    the fixture disable. Do not erase legitimate history
    from a previously used thread.
4. Run Codex and Claude marketplace/Hook smokes appropriate to changed files.
    Initial accepted baselines are Codex CLI 0.160.0 and Claude Code 2.1.283;
    record the actual versions and any unavailable platform evidence.
    Await subprocess close, including stdio, before temporary-tree cleanup.
    Codex smoke children use GIT_ALLOW_PROTOCOL=file and GIT_TERMINAL_PROMPT=0
    to prevent an unrelated remote Git catalog probe from retaining inherited
    streams after app-server exit. Public GitHub HTTP catalog fallback may still
    occur; model requests remain loopback-only. Parent Git configuration and
    environment remain unchanged.
5. Amend documentation to distinguish explicit invocation evidence from
    unverified automatic Desktop starter-prompt behavior. Keep smoke opt-in,
    scoped to disposable state, with no user targets or external inference.
6. Typecheck and run relevant checks, self-review, then commit owned files.

## Task 4: Require independent host metadata research

Commit: `docs(governance): require independent host metadata research`.

1. Add docs/host-metadata.md with date and tested host baselines, direct primary
    documentation/versioned implementation links and a field matrix covering
    manifest, marketplace, Skill and MCP metadata consumed in self-installation.
    Record consumer, defaults/precedence/path base, adopted value or omission,
    necessity and evidence level; clearly label unsupported or unverified UI.
2. Require the same research before adding any future host or changing its
    metadata contract. Put the authoritative rule in documentation policy and
    link it from contributor entry/navigation; amend quality/tooling guidance
    and ADR 0012 to explain host-only presentation additions to shared files.
3. Require repository documentation to be independently understandable, naming
    goals, decisions, current behavior and evidence without relying on a chat.
    Keep primary research ownership in one document; avoid duplicated rules.
4. Update relevant README/user-guide/navigation and meaningful Unreleased
    notes. Remove unsupported automatic starter-prompt context promises and
    public-submission requirements presented as local-install requirements.
5. Retain this implementation plan in the plan index. Run documentation audits,
    regenerate payloads if maintained copied docs change, verify output and
    commit owned files.

## Final verification and delivery

Complete the trusted install sequence and verify generated pre-push hook entry
in this worktree. Run focused tests, pnpm typecheck, pnpm build:plugin,
pnpm check:build, pnpm check:security, pnpm verify:push and relevant real host
smokes. Review each task and the final branch on gpt-6.1-sol Ultra.

Prepare a concrete PR using the current template and actual evidence. Attach it
to the chat. Do not merge until manual Desktop acceptance and latest PR checks
pass; if longDescription does not render, remove it and update the evidence.
After merge, verify the resulting main checks, then archive this managed
worktree without removing the PR attachment.
