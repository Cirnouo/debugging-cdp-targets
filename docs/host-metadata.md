# Host metadata for self-installation

Research and acceptance date: 2026-10-08. Version 0.1.0 remains unreleased.
The goal is useful, accurate metadata when users add this GitHub repository's
Marketplace and install either complete host Plugin. Public directory submission
is outside this contract. This document owns primary host research under the
[documentation policy](policies/documentation.md#host-metadata-research).

## Sources and evidence levels

The following primary sources establish separate consumers. Live documentation
was researched on the date above; versioned source is used for version-specific
behavior. A documented field is not proof of a particular UI rendering it.

- **C1 — Codex package/catalog:** [official packaging documentation](https://developers.openai.com/plugins/build/plugins)
    and [0.161.0 compatibility manifest parser](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/manifest.rs).
    [0.160.0 component loading](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core-plugins/src/loader.rs#L1081-L1119)
    establishes component defaults. Compatibility packaging is retained; a
    portable root manifest's `extensions.com.openai`, when present, replaces
    rather than merges the compatibility overlay.
- **C2 — Codex Skill:** [official Skill metadata documentation](https://learn.chatgpt.com/docs/build-skills#optional-metadata),
    [0.160.0 YAML reader](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/ext/skills/src/loader/metadata.rs#L130-L153),
    [PluginShared asset resolution](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/skills/src/interface.rs#L124-L146),
    [host loader](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/ext/skills/src/loader/host.rs)
    and [namespace resolver](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/ext/skills/src/loader/namespace.rs).
- **C3 — Codex inspection/context:** [official App Server API](https://learn.chatgpt.com/docs/app-server#skills),
    [0.161.0 configuration-write handler](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server/src/request_processors/catalog_processor.rs#L646)
    and [Skill configuration rules](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/config/src/skills_config.rs).
    The API documentation currently mentions `SKILL.json` for returned metadata;
    the inspected loader and executed API use `agents/openai.yaml`. This package
    follows the actual YAML consumer; the documentation mismatch is not evidence
    for adding a JSON metadata file.
- **C4 — Codex cache/install:** [official CLI Plugin and Marketplace reference](https://learn.chatgpt.com/docs/cli/reference#codex-plugin)
    separates Marketplace upgrade from Plugin add; [official packaging cache documentation](https://developers.openai.com/plugins/build/plugins#how-local-marketplaces-work)
    explains that hosts load the installed cached copy. The inspected 0.161.0
    [install manager](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/manager.rs#L2245-L2319)
    materializes the selected source and invokes the store even for the same
    version; the [store replacement](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/store.rs#L648-L690)
    stages and replaces an existing cache root with backup/rollback handling.
    The executed same-version refresh below is bounded to Codex CLI 0.161.0.
- **L1 — Claude package:** [official Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference).
    Local loading and listing-only fields are distinguished there.
- **L2 — Claude catalog:** [Marketplace creation/install documentation](https://code.claude.com/docs/en/plugin-marketplaces)
    and [Marketplace field reference](https://code.claude.com/docs/en/plugins/marketplace-reference).
- **L3 — Claude Skill:** [official frontmatter reference](https://code.claude.com/docs/en/skills#frontmatter-reference).
- **M1 — MCP:** [2025-11-25 initialization/lifecycle specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
    and [tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
    Protocol metadata does not prescribe host UI behavior. The
    [Codex 0.160.0 MCP config parser](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/codex-mcp/src/plugin_config.rs#L294-L304)
    anchors a relative stdio cwd to the Plugin root.

In the matrix, **docs/source** means documented or versioned consumer support;
**repository** means source/inventory/byte validation; **CLI** means executed
installed-host discovery or captured model requests; **manual UI** means the
dated human Desktop check below. Fields outside that check remain unverified.
These evidence levels are not interchangeable.
Source references C1–M1 above apply to the rows that name them.

## Adopted field matrix

Paths identify maintained inputs. Generated equivalents live in each
`plugins/<host>/debugging-cdp-targets/` payload. “Required” below means necessary
for this package's functional identity/wiring or its selected quality contract;
optional host features are not inferred requirements.

| Interface / fields | Consumer, defaults, path base and precedence | Adopted value or omission; necessity and reason | Evidence / boundary |
| --- | --- | --- | --- |
| Both `packaging/codex/.codex-plugin/plugin.json` and `packaging/claude-code/.claude-plugin/plugin.json`: `name`, `version`, `description`, `keywords` | Host package identity/discovery (C1/L1); no cross-host field equivalence is inferred. | `debugging-cdp-targets`, unreleased `0.1.0`; description `Connect Codex directly to the official Chrome DevTools MCP Server for a verified local CDP target.` or the same text with `Claude Code` replacing `Codex`; keywords `cdp`, `devtools`, `debugging`. Identity/version required; discovery text useful. | Repository and CLI; wording is not UI proof. |
| Both manifests: `author`, `repository`, `homepage`, `license` | Claude validates provenance/documentation fields (L1). Codex's inspected compatibility parser omits author/repository/homepage/license from its raw model (C1). | `author.name: Cirnouo`, `MIT`, repository and homepage both `https://github.com/Cirnouo/debugging-cdp-targets`; author email/url omitted because no additional contact contract is needed. Retain package provenance. | Repository; Codex compatibility loading does not consume these keys. Website UI requires the separate Codex interface field. |
| Codex manifest: `mcpServers`, `hooks`, `skills` | C1; explicit paths resolve from Plugin root and select components. Without explicit roots, default Skill directory is `skills/`, MCP file `.mcp.json`, Hooks `hooks/hooks.json`. | Explicit `./mcp.json`, `./hooks/hooks.json`, `./skills/`; required wiring/discovery and retained compatibility layout. `apps`/`onboardingSkill` omitted: no remote app or setup Skill. | Docs/source, repository, installed CLI component inventory. |
| Codex `interface`: `displayName`, `shortDescription`, `developerName`, `category` | C1; separate Plugin interface metadata, not Skill presentation. | `Debugging CDP Targets`, `Inspect verified local CDP targets with Chrome DevTools`, `Cirnouo`, `Developer Tools`; useful presentation. | Returned through real `plugin/read`; these Plugin interface fields were not separately accepted in the manual Skill presentation check. |
| Codex `interface.websiteURL`, `longDescription` | C1; `websiteURL` alias is consumed into the resolved interface and returned by the API. | Website is the exact project URL. Retained long description describes launching a new verified app, selected isolation, official tools and Close/Keep. It is adopted after actual Desktop rendering confirmation. | CLI confirms returned values; manual UI confirms website navigation and full long description. `homepage` alone is not this API consumer. |
| Codex `interface.defaultPrompt` | C1; local resolver normalizes whitespace, keeps at most three prompts and drops entries over 128 Unicode scalar values. | Three existing distinct single-line prompts for screenshot, console/network and performance tasks. Project validator requires exactly three, nonempty, distinct, at most 128 Unicode code points; useful starters without duplicating the Skill name. | [0.161.0 resolver](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/manifest.rs#L533-L551); 0.160.0 has the same bound. Repository boundary tests accept 128 ASCII/non-BMP points and reject 129; CLI returns existing prompts. Automatic full Skill injection is unverified. |
| Codex `interface.logo`, `logoDark`, `composerIcon`, `composerIconDark` | C1; `./` paths start at Plugin root. `logoDark` is recognized; inspected 0.160/0.161 compatibility raw/resolved interfaces have no `composerIconDark`. | Existing `./assets/icon.png` for base logo/composer, `./assets/icon-dark.png` for dark keys. Retain artwork and fields; no new asset profile or consumer. | Repository approved PNG/integrity checks are project quality, not public submission rules or UI proof. Existing dark composer key is ignored by this parser; individual manifest icon surfaces and dark-mode rendering were not manually verified. |
| Other Codex interface fields | C1 supports optional presentation; existence does not create a package requirement. | `capabilities`, `screenshots`, `brandColor`, privacy/terms URLs omitted: no task need or separately supported content. | Deliberate omission; no publication contract adopted. |
| Claude `displayName`, `icon` | L1; display title does not change Plugin namespace. Local loader ignores directory listing `icon` and listing URLs; unknown top-level fields may be stripped with warnings. | Display title `Debugging CDP Targets`; retain `./assets/icon.png`. Useful title/provenance; do not infer a local icon display consumer or add a dark field. | Manifest/cache CLI checks; icon presence is not local rendering evidence. |
| Claude component/config fields | L1; defaults scan `skills/`, `.mcp.json`, `hooks/hooks.json`; explicit Skill paths add to defaults, MCP definitions merge with later names winning. `defaultEnabled` defaults true. | Explicit `skills`, `hooks`, `mcpServers`, `defaultEnabled`, settings/dependencies/userConfig/channels omitted. Defaults already supply components and enabled state; no new configuration contract. | Repository and executed CLI default discovery. |
| `.agents/plugins/marketplace.json` | C1; catalog source path starts at Marketplace root, not `.agents/plugins/`; catalog and entry identity differ from display title. | Name `debugging-cdp-targets`, title `Debugging CDP Targets`; same entry name; local `./plugins/codex/debugging-cdp-targets`; `AVAILABLE` / `ON_INSTALL`, category `Developer Tools`. Required self-install pointer/policy. | Repository and selected local Marketplace CLI. Authentication policy is not proof this stdio gateway authenticates. |
| Codex installed manifest/Skill metadata | C4; the host consumes its installed cache, independently from the tracked Marketplace snapshot. Source version selects the cache destination; a same-version Plugin add performs installation again. | Retain version `0.1.0`; refresh the catalog, then reinstall its current payload. Required to load updated metadata without confusing source freshness with cache freshness. | Versioned source and actual 0.161.0 same-version marker/stale-file/config fixture; dated full cache identity and manual UI below. |
| `.claude-plugin/marketplace.json` | L2; relative source starts at repository/Marketplace root. Entry display fields override manifest equivalents; manifest version wins; `strict` defaults true. | Same catalog/entry name, owner Cirnouo; existing catalog description and entry description matching Claude manifest; source `./plugins/claude-code/debugging-cdp-targets`. Entry displayName/version/components/category/tags/relevance omitted: leave title/version/components with one manifest owner. | Repository and CLI cache/install. No entry components means the strict component-conflict case is inapplicable. GitHub uses cached copies; local-directory loading alone does not prove GitHub cache/update behavior. |
| Shared `packaging/shared/skills/debugging-cdp-targets/SKILL.md` frontmatter/body | C2/L3; discovery and explicit instructions. Claude defaults name to directory, description to first body line if absent; Plugin namespace qualifies invocation. | Existing name/description, license MIT, metadata.version `0.1.0`, complete unchanged body. Required shared workflow; package license/version are not routing evidence. | Every maintained shared Skill file matches both payloads in both directions; actual captured explicit body in both hosts. |
| Codex `packaging/codex/skill-openai.yaml` | C2; maps to `skills/debugging-cdp-targets/agents/openai.yaml`; interface is independent from Plugin interface. PluginShared icons resolve from Skill directory and are confined to this Plugin's assets. | Only interface: `display_name: Debugging CDP Targets`, `short_description: Debug verified local CDP targets`, both icon fields `../../assets/icon.png`. Useful Skill presentation using existing artwork. | Real YAML parser, exact overlay inventory/regular PNG byte checks; `skills/list` returns title/description/absolute icons. Manual UI confirms Skill title/short description/icons. This traversal is not allowed for standalone Skills or generic manifest paths. |
| Skill invocation policy/dependencies | C2/L3; Codex implicit invocation defaults true; Claude `disable-model-invocation` defaults false and `user-invocable` true. | Codex brand color/default prompt/policy/dependencies omitted; preserve defaults without duplicating starters or inventing dependencies. Claude has no Codex overlay: no documented local YAML consumer established. | Docs/source; automatic Desktop starter behavior not proven by these defaults. |
| Codex `packaging/codex/mcp.json` | M1/C1; schema is configuration/editing metadata. Relative stdio cwd starts at Plugin root. | Agent Plugins MCP schema 1.0.0; `cdp-targets`, stdio `node`, args `dist/mcp-bootstrap.mjs`, cwd `.`. Required local wiring. | Repository and installed gateway CLI discovery. |
| Claude `packaging/claude-code/.mcp.json` | L1/M1; default root discovery; `${CLAUDE_PLUGIN_ROOT}` expands to installed Plugin root in args. | Same key/type/command; args `${CLAUDE_PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`. Required portable launch; no remote URL/auth/headers. | Repository and installed gateway CLI discovery. No shared implicit cwd assumption. |
| MCP initialize / tools: `src/adapters/mcp-entry-server.ts`, `lifecycle-tools.ts` | M1; server implementation information, optional instructions, and discovered tool metadata are independent from package presentation. | Server name/version `debugging-cdp-targets` / `0.1.0`, tools capability; title/description/icons/websiteUrl/instructions omitted. Official Tool objects retained with required `_dct` routing extension; seven lifecycle tools have existing name/description/inputSchema. | Existing runtime/catalog contract; no runtime metadata additions. Official annotations/output metadata survive when supplied; no new lifecycle title/icons/annotations/outputSchema. Both CLI smokes discover 73 tools. |

The retained `longDescription` is exactly:

> Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.

The retained Plugin starter strings are “Open https://example.com in a new Chrome
window and capture a screenshot.”, “Check console errors and failed requests in a
new Chrome window.” and “Profile page load performance in a new Chrome window.”
They are starter text, with explicit Skill invocation documented separately.

## Executed host acceptance and its limits

On Windows, actual Codex CLI **0.161.0** and Claude Code **2.1.294** passed the
selected Marketplace installed-tree/gateway smokes and all **eight Hook/Skill
scenarios per host** on 2026-10-08. The maintained commands and assertions are in
[smoke instructions](../tests/smoke/README.md), [Codex Marketplace smoke](../tests/smoke/marketplace.ts),
[Codex Hook/Skill smoke](../tests/smoke/codex-hooks.ts),
[Claude Marketplace smoke](../tests/smoke/claude-marketplace.ts) and
[Claude Hook/Skill smoke](../tests/smoke/claude-hooks.ts).
Historical accepted baselines Codex 0.160.0 and Claude 2.1.283 were not rerun;
Claude 2.1.283 remains the first supported baseline.

Codex `skills/list` resolved the installed Skill to
`debugging-cdp-targets:debugging-cdp-targets`, scope `user`. Plugin provenance
comes from `pluginId` plus the exact canonical installed SKILL.md path, not
scope or bare name alone. Formal `skill` input uses this discovered name/path
and a matching dollar marker. The first captured loopback model request contains
the full installed production body and current isolation/occupancy/Close-Keep
instructions; the harness does not copy the body into its prompt. After temporary
disable/reload, a distinct neutral thread has zero enabled Skills and lacks that
body and isolation section. Claude's explicit invocation also supplied the full
installed body at the captured model boundary.

The [Codex smoke helper](../tests/smoke/codex-host.ts) disables nonfixture Skills
through the formal API into disposable CODEX_HOME before model threads, refreshes
discovery, and requires the exact fixture enabled set. It checks model-visible
paths and distinct unrelated metadata; approved identical metadata is not
misattributed to a disabled duplicate. This changes no global Skill or personal
configuration. Windows discovery can still read global SKILL.md before these
disables: [0.161.0 host roots](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/ext/skills/src/host_roots.rs)
use `dirs::home_dir()`, whose [pinned dirs 6.0.0 API](https://docs.rs/dirs/6.0.0/dirs/fn.home_dir.html)
uses Windows Known Folder profile resolution independently of CODEX_HOME and
child HOME/USERPROFILE. This is temporary configuration/model-context control,
not OS-profile or no-read isolation.

Child-only `GIT_ALLOW_PROTOCOL=file` and `GIT_TERMINAL_PROMPT=0` constrain an
unrelated automatic Git catalog probe that could retain inherited streams after
app-server exit. [Git's documented protocol allowlist](https://git-scm.com/docs/git#Documentation/git.txt-GITALLOWPROTOCOL)
permits local fixture Git while denying remote Git transports. Codex's
[0.161.0 catalog synchronization](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/startup_sync.rs)
can still use in-process GitHub HTTP/public metadata/archive fallback inside
disposable CODEX_HOME. Model requests use only the loopback fixture; this is not
complete host network/catalog suppression. Final Codex Marketplace and eight
scenarios exited normally with stdio closed and temporary cleanup successful.
Earlier cleanup EBUSY/stall diagnostics informed harness fixes; they are not a
new product warning or user workflow.

## Codex cache refresh

Codex CLI 0.161.0 has distinct consumers for the tracked Marketplace source and
the installed Plugin cache. `codex plugin marketplace upgrade debugging-cdp-targets`
refreshes the selected Git catalog source. Run
`codex plugin add debugging-cdp-targets@debugging-cdp-targets` afterward to
reinstall its current payload, even while its version stays 0.1.0. Catalog
freshness alone is not installed-cache freshness. The
[installation guide](user-guide/installation.md#update-or-uninstall-in-codex)
owns the supported user commands.

An actual 0.161.0 disposable-configuration test on 2026-10-08 changed a source
marker without changing its Plugin version, then reinstalled. The cache acquired
the new marker, removed a file that existed only in the old payload, and
preserved Hook trust and model-provider configuration. The host stages a fresh
payload and replaces the previous same-version cache; it does not assume that
matching version strings imply matching bytes. Changing an already configured
Marketplace's Git ref requires removing and re-adding that Marketplace before
Plugin add; another Marketplace add does not silently replace its tracked ref.
The matching [source identity check](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/marketplace_add/metadata.rs#L179-L184)
includes source URL, ref and sparse paths; [different-source add](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/marketplace_add.rs#L186-L193)
is rejected. [Marketplace removal](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/marketplace_remove.rs#L49-L107)
removes that catalog configuration/snapshot while retaining the installed Plugin
cache/configuration; the fixture also verified that distinction. Plugin add sets
the selected Plugin enabled, so preservation of unrelated configuration is not a
claim that installation leaves that Plugin's enablement unchanged.
This evidence establishes the tested CLI refresh contract, not a guarantee that
every platform permits the cache filesystem transaction.

## Manual Desktop acceptance

On 2026-10-08, the human confirmed that the project website opens the official
repository, the Skill title/short description/icons display, and the full long
description renders. Tested Desktop version **26.1002.52244**, build **13536**,
production channel, came from official app metadata. The tested source was
[ebcd580eb48e6a3fb9de408c0f88e2b9179a33d0](https://github.com/Cirnouo/debugging-cdp-targets/commit/ebcd580eb48e6a3fb9de408c0f88e2b9179a33d0),
the reviewed head of [PR 26](https://github.com/Cirnouo/debugging-cdp-targets/pull/26).
This is manual navigation/rendering evidence, separate from the CLI API and
model-boundary results. Retain the long description on that basis.

Cache freshness was verified before the human check. A clone pinned to the
tested GitHub source supplied the expected Codex payload, and all **380 files**
in the installed `CODEX_HOME/plugins/cache/debugging-cdp-targets/debugging-cdp-targets/0.1.0/`
matched it. After authorization to refresh only this Plugin's source/cache,
supported Marketplace remove/add selected the tested ref; daily Plugin add then
failed its cache backup rename with Windows access denied (OS error 5). That
daily managed install transaction did not succeed. A bounded repair of exactly
five text metadata/documentation files, each replaced atomically from the
verified pinned payload, produced the complete 380-file match. Runtime, artwork,
Hooks and shared Skill bytes were unchanged; personal configuration and Hook
trust bytes were unchanged during the repair. This is dated acceptance
preparation evidence, not a replacement for the supported update commands.

The documentation follow-up preserves the tested presentation fields, YAML,
icons, shared instructions and runtime byte for byte. Its documentation changes
do not broaden the measured UI scope. Plugin developer/category fields,
individual manifest icon surfaces, dark-mode-specific rendering and automatic
full Skill injection from starter prompt selection were not manually verified.
Use explicit Skill invocation for the proven complete-instruction workflow.
