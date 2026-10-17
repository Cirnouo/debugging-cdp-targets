# Host metadata for self-installation

Original research and acceptance date: 2026-10-08. A separate Desktop
presentation study and Skill/MCP research dated 2026-10-09 appear below.
Version 0.1.0 remains unreleased.
The goal is useful, accurate metadata when users add this GitHub repository's
Marketplace and install either complete host Plugin. Public directory submission
is outside this contract. This document owns primary host research under the
[documentation policy](policies/documentation.md#host-metadata-research).

## Direct HTTP cutover

The 2026-10-17 App cutover changes the maintained connection contract. Both thin
payloads point at `http://127.0.0.1:27637/mcp`; neither contains Hooks, executable
runtime, bearer headers or dependency scripts. Codex portable MCP declares
`type: "streamable-http"` using the pinned
[0.161.0 portable agent Plugin configuration parser](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/agent_plugin_config.rs).
Claude declares `type: "http"` using its
[official MCP HTTP configuration](https://code.claude.com/docs/en/mcp#connect-to-a-remote-http-server).
App port edits require matching native host configuration after App restart.
Registration ownership is explicit per tool request, independent of host MCP
session reuse; initialization does not implicitly register a chat.

The earlier dated installation, model-context Hook and Desktop presentation
records below remain historical evidence for those exact sources and hosts.
They do not prove HTTP tool execution, App GUI, current host icon rendering or
installer behavior. Current Marketplace/instructions smokes connect to an
already running App and retain their actual host version; SDK metadata capture
is recorded separately from host consumption. Repository metadata validation is
an independent static gate and never substitutes for either native host result.

## MCP protocol compatibility research — 2026-10-17

Retrieved 2026-10-17. This fixed-version record distinguishes published
host/source support from an actual host exchange. The App now serves both
2026-07-28 and sessionful legacy HTTP under the same Plugin URL; no metadata flag,
personal configuration change or MCP Tasks requirement accompanies that endpoint.
The [protocol ADR](adr/0018-mcp-protocol-compatibility.md) preserves the fixed
outward catalog and operation wait/result path independently of host refresh.

The canonical npm/release checks identified Codex `latest=0.163.0`
(2026-10-15) and Claude Code `latest=2.1.302`, `next=2.1.302` (2026-10-16), both
non-prerelease releases. Claude's separately named `stable` update channel was
2.1.292; it is distinct from latest. Primary identities are the
[Codex registry](https://registry.npmjs.org/@openai%2fcodex),
[Codex release](https://github.com/openai/codex/releases/tag/rust-v0.163.0),
[Claude registry](https://registry.npmjs.org/@anthropic-ai%2fclaude-code) and
[Claude release](https://github.com/anthropics/claude-code/releases/tag/v2.1.302).

| Feature | Codex 0.163.0 | Claude Code 2.1.302 | Evidence boundary |
| --- | --- | --- | --- |
| Default protocol | Versioned source leaves `mcp_2026_07_28` under development and disabled; the ordinary path prefers legacy 2025-06-18. | Official documentation describes SDK-v2 modern negotiation with runtime/flag/fallback conditions. | Preserve legacy default compatibility; a modern SDK fixture does not identify the host's negotiated era. |
| Model-facing tool refresh | The ordinary path reads a local tool catalog. Receipt/logging and SDK cache invalidation do not refresh that host snapshot. | Dynamic tool refresh and newer-revision notification streams are documented. | The fixed outward catalog does not depend on a host refreshing its model tools. |
| Progress | Inspected ordinary handler logs progress; UI/model relay is not established. | Versioned changelog records progress rendering and long-call fixes. | Optional progress does not guarantee every host displays it. |
| MCP Tasks | Ordinary extension selection omits Tasks; tool-input handling accepts ordinary and input-required results. | Tasks advertisement and a complete task flow remain unverified. | Keep operation wait/status/result. Native background-task UI is a separate feature. |

Codex references resolve to commit `83086188ae0614bd882818ff1aa23f3194962012`:
[feature default](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/features/src/lib.rs#L1541-L1551),
[protocol policy](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/rmcp-client/src/protocol_mode.rs#L8-L53),
[ordinary catalog ownership](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/codex-mcp/src/rmcp_client.rs#L1063-L1075),
[catalog variants](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/codex-mcp/src/client_tool_catalog.rs#L45-L84),
[notification handler](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/rmcp-client/src/logging_client_handler.rs#L63-L92),
[extension selection](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/codex-mcp/src/client_capabilities.rs#L34-L68)
and [tool input](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/rmcp-client/src/tool_input.rs#L39-L87).
These negative findings are bounded to the inspected ordinary configured/plugin
external-server path, independently of host-owned Codex Apps.

Claude references are the official [runtime documentation](https://code.claude.com/docs/en/mcp#mcp-client-runtimes),
[dynamic updates](https://code.claude.com/docs/en/mcp#dynamic-tool-updates),
[notification streams](https://code.claude.com/docs/en/mcp#notification-streams-on-the-v2-runtime)
and the [2.1.302 changelog](https://github.com/anthropics/claude-code/blob/c017428c8c27e604840435048d5bce6a9a22c040/CHANGELOG.md).
The latter records `subscriptions/listen` fixes in 2.1.233, notification-storm
refresh fixes in 2.1.271, newer HTTP negotiation defaults in 2.1.274 and complete
modern result/cache field compatibility in 2.1.302. Exact installed-session flags,
subscription filters and modern negotiation have not been captured by this
research. The [long-call UI](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)
does not establish `io.modelcontextprotocol/tasks` support.

Actual public-SDK modern/legacy HTTP regressions establish the App's serving
boundary, including MRTR and progress. Existing `independent-sdk-http` host-smoke
fixtures remain SDK evidence. No native Codex/Claude initialize/discovery envelope,
acknowledged subscription filter or Tasks flow is claimed here. Final native
default-host acceptance must identify exact host versions, settings, final source
and observed register/status results separately; earlier target/GUI checks do not
prove this protocol change's wire behavior.

## Sources and evidence levels

The following primary sources establish separate consumers. Live documentation
was researched on the original date above; versioned source is used for
version-specific behavior. A documented field is not proof of a particular UI
rendering it.

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
- **C5 — Codex Desktop Skill presentation:** locally inspected packed
    `resources/app.asar` on 2026-10-09. Its `package.json` identifies Windows
    Desktop version **26.1002.52244**, `codexBuildNumber` **13536** and
    `codexBuildFlavor` **prod**. The outer Windows MSIX package version
    **26.1002.7124.0** is a different distribution identity; CLI and daemon
    versions do not identify this renderer.
    The packed source has no public source URL. Reproducible consumer references
    are `webview/assets/app-initial-25361a10f2bf.js` (`ZOc`, `CNe`/`TMe`, `wR`,
    `Ebr`), `webview/assets/app-shared-40678a67f0e3.js` (`zRr`, `RRr`/`LRr`,
    `yJr`, `P2`) and `webview/assets/plugin-detail-view-dd0bb2666944.js` (`Ma`).
    Their separate presentation paths and evidence limits are recorded below;
    this is source inspection, not a new API or manual rendering check.
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
dated human Desktop checks or user screenshots below. Packed Desktop source
inspection is identified separately from actual navigation and rendering.
Fields outside those checks remain unverified.
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
| Shared `packaging/shared/skills/debugging-cdp-targets/SKILL.md` and `references/` | C2/L3; discovery and explicit entry instructions. Claude defaults name to directory, description to first body line if absent; Plugin namespace qualifies invocation. | Existing frontmatter name/description, license MIT and metadata.version `0.1.0`; shared entry retains workflow and question rules, with common contract and language catalogues read only for a needed question. No host metadata changes; package license/version are not routing evidence. | Repository checks compare every maintained shared Skill file with both payloads in both directions. Historical host smokes captured entry-body injection; they do not establish conditional reference reads or language selection. |
| Codex `packaging/codex/skill-openai.yaml` | C2; maps to `skills/debugging-cdp-targets/agents/openai.yaml`; interface is independent from Plugin interface. PluginShared icons resolve from Skill directory and are confined to this Plugin's assets. | Only interface: `display_name: Debugging CDP Targets`, `short_description: Debug verified local CDP targets`, both icon fields `../../assets/icon.png`. Useful Skill presentation using existing artwork. | Real YAML parser, exact overlay inventory/regular PNG byte checks; `skills/list` returns title/description/absolute icons. The 2026-10-08 manual check confirms Skill title/short description/icons in Plugin detail only. The separate C5 Desktop study below bounds picker and mention behavior. This traversal is not allowed for standalone Skills or generic manifest paths. |
| Skill invocation policy/dependencies/default prompt | C2/L3 and the 2026-10-09 research below; invocation defaults, dependency installation and composer prefill have separate consumers. | Keep Codex policy/dependencies/default prompt/brand color omitted and Claude defaults unchanged for the reasons below. Claude has no Codex overlay: no documented local YAML consumer established. | Docs/versioned source and Desktop static consumers; no new invocation or prefill UI acceptance. |
| Codex `packaging/codex/mcp.json` | M1/C1; schema is configuration/editing metadata. Relative stdio cwd starts at Plugin root. | Agent Plugins MCP schema 1.0.0; `cdp-targets`, stdio `node`, args `dist/mcp-bootstrap.mjs`, cwd `.`. Required local wiring. | Repository and installed gateway CLI discovery. |
| Claude `packaging/claude-code/.mcp.json` | L1/M1; default root discovery; `${CLAUDE_PLUGIN_ROOT}` expands to installed Plugin root in args. | Same key/type/command; args `${CLAUDE_PLUGIN_ROOT}/dist/mcp-bootstrap.mjs`. Required portable launch; no remote URL/auth/headers. | Repository and installed gateway CLI discovery. No shared implicit cwd assumption. |
| MCP initialize / tools: `src/adapters/mcp-entry-server.ts`, `lifecycle-tools.ts` | M1; server implementation information, optional instructions, and discovered tool metadata are independent from package presentation. | Server name/version `debugging-cdp-targets` / `0.1.0`, tools capability; title/description/icons/websiteUrl omitted; the exact 689-byte instructions paragraph implemented through official SDK options below. Official Tool objects retained with required `_dct` routing extension; seven lifecycle tools have existing name/description/inputSchema. | Existing runtime/catalog contract; initialization instructions added without changing identity or capabilities. Official annotations/output metadata survive when supplied; no new lifecycle title/icons/annotations/outputSchema. Both CLI smokes discover 73 tools. |

The retained `longDescription` is exactly:

> Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.

The retained Plugin starter strings are “Open https://example.com in a new Chrome
window and capture a screenshot.”, “Check console errors and failed requests in a
new Chrome window.” and “Profile page load performance in a new Chrome window.”
They are starter text, with explicit Skill invocation documented separately.

## Skill and MCP research — 2026-10-09

This update independently distinguishes invocation, dependency installation,
composer prefill, protocol identity and model discovery. Actual local versions
are Codex CLI **0.162.0** and Claude Code **2.1.295**; version checks identify
those executables only. This section records documentation and static source
research, not new host smokes, UI acceptance or model adherence. Historical
acceptance below keeps its original versions and dates.

| Skill surface | Consumer and supported behavior | Decision and reason |
| --- | --- | --- |
| Codex `policy.allow_implicit_invocation` | Defaults true. The [host provider](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/ext/skills/src/provider/host.rs#L146), [catalog](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/ext/skills/src/catalog.rs#L256) and [list tool](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/ext/skills/src/tools/list.rs#L91) hide false-valued Skills from model discovery. [Explicit selection](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/ext/skills/src/selection.rs#L21) independently requires enablement. | Omit and retain true. This is discovery policy, not permission to launch or bypass the Skill workflow. |
| Codex `dependencies.tools` | The [YAML model](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/ext/skills/src/loader/metadata.rs) cannot express stdio args/cwd/env. [Dependency matching](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/mcp_skill_dependencies.rs#L368-L393) compares transport and command only; [missing installation](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/mcp_skill_dependencies.rs#L450) constructs empty args/env/cwd. Configuration edits are [feature/approval gated](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/mcp_skill_dependencies.rs#L125). | Omit. A `node` dependency cannot accurately identify this gateway's bootstrap args and Plugin cwd. The bundled `mcp.json` already owns correct wiring. |
| Codex Skill `interface.default_prompt` | Optional string in the YAML model, distinct from Plugin `interface.defaultPrompt` array. C5's `app-shared-40678a67f0e3.js` `SRr` reads `defaultPrompt`; `DRr` appends the Skill link when needed and exports `ZY`. `skill-card-2699b546e0ea.js` imports `ZY` as `se`; its `onTryInThread` handler invokes `me({prefillPrompt:se(v),startInSidebar:true})`. | Omit: no independent Skill prefill need. A static Skill-card Try prefill consumer is established; actual UI clicking and subsequent full instruction injection are unverified. |
| Claude `when_to_use`, `argument-hint`, `allowed-tools` | The [official frontmatter reference](https://code.claude.com/docs/en/skills#frontmatter-reference) describes appended discovery text (1,536-character listing bound), autocomplete hints and temporary turn preauthorization respectively. | Omit. The existing description covers trigger scope, there is no stable parameter workflow or new preauthorization need. `allowed-tools` is neither dependency wiring nor a permanent allowlist. |
| Claude invocation switches | The same reference defaults `disable-model-invocation` to false and `user-invocable` to true. | Retain defaults and the unchanged shared Skill; no host-only overlay is needed. |

MCP `serverInfo`, `capabilities` and `instructions` are separate initialization
fields under M1. The maintained SDK 2.2 supports optional implementation fields
and Server options instructions. Existing `name: debugging-cdp-targets`,
`version: 0.1.0` and `tools: {}` accurately describe the gateway; no additional
capabilities are warranted. The configured outer server key `cdp-targets` and
advertised inner implementation name `debugging-cdp-targets` have distinct roles.

| MCP surface | Consumer and evidence | Decision and remaining limit |
| --- | --- | --- |
| `serverInfo` and capabilities | Codex [retains implementation fields](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/codex-mcp/src/rmcp_client.rs#L1131); the [status processor](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/app-server/src/request_processors/mcp_processor.rs#L529) and generated `McpServerInfo`/`McpServerStatus` expose `serverInfo` and `serverCapabilities`. | Keep existing identity and tools capability. The production-adapter initialize regression verifies the unchanged name/version and exact tools capability; host API observability remains source evidence. |
| Optional `title`, `description`, `icons`, `websiteUrl` | C5's `app-initial-25361a10f2bf.js` has conditional metadata consumers: `N_n` mention/search tools gated by `openai/mentions`, `I_n` file metadata and `W_n` `openai/settings`. `H_n` chooses `tool_meta.connector_name ?? serverInfo.title ?? name`. `app-shared-40678a67f0e3.js` `Rqr` (export `CG`) accepts HTTPS/data icons with theme fallback. | Keep omitted: no applicable ordinary gateway presentation benefit was found. These fields are not declared unsupported. Claude-specific optional display consumers and actual Desktop presentation remain unverified. |
| `instructions` in Codex | [Initialization and namespace conversion](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/codex-mcp/src/rmcp_client.rs#L843) retain instructions as `namespace_description` ([conversion](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/codex-mcp/src/rmcp_client.rs#L1027)); the [tool handler](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/tools/handlers/mcp.rs#L514-L579) uses it in namespace/search descriptions. The Plugin path truncates at a UTF-8 boundary within 1,000 bytes. | **IMPLEMENTED:** return the [execution plan's exact 689-byte text](superpowers/plans/2026-10-09-mcp-instructions.md#production-text) through official SDK options, supplementing the full Skill. Production-adapter protocol regression verifies exact text, workflow anchors and the byte bound. Actual 0.162.0 Plugin namespace/search consumption passed in the dated acceptance below. |
| `instructions` in Claude | [Official server-author guidance](https://code.claude.com/docs/en/mcp#for-mcp-server-authors) says instructions help tool search and documents a 2,048-character bound. | Use the same implemented text; it fits both researched bounds. Actual 2.1.295 first-request consumption passed through the scoped host reminder documented below; search execution and real-model adherence remain unverified. |

### MCP instruction consumption acceptance, 2026-10-09

Independent opt-in smokes captured real outbound loopback model requests from
Codex CLI 0.162.0 and Claude Code 2.1.295. Temporary Plugins preserve production
manifests, assets and Skill bytes; only their MCP command selects the target-free
production-adapter fixture. The fixture advertises the seven actual lifecycle
tools, obtains the exact 689-byte instructions from the production adapter, and
records initialize/discovery while failing every tools/call. It imports no
gateway runtime, catalog router, process manager or official upstream.

| Host | Actual request carrier and verification | Evidence limits |
| --- | --- | --- |
| Codex CLI 0.162.0 | After one controlled `tool_search_call` for `dct_connection_status`, the second actual request contains the complete paragraph at `$.tools[11].description` and `$.input[5].tools[0].description`. Server status identifies `debugging-cdp-targets@dct-instructions-test`, and exposes seven lifecycle declarations. | Search metadata consumption only; the substitute model returns final text without any MCP tool call. |
| Claude Code 2.1.295 | The first actual request contains the complete paragraph at `$.messages[0].content[3].text`: an exact `<system-reminder>` block headed `# MCP Server Instructions`, with sole scope `## plugin:debugging-cdp-targets:cdp-targets`. An independent reminder at `$.messages[0].content[2].text` lists exactly seven deferred Plugin tool names. Upfront tools are `ToolSearch` and an optional exact `DeferredToolPlaceholder`; MCP callable schemas are absent. | The transport role is `user`, not `$.system`. The host's actual system text describes reminder blocks as system context. One final substitute-model text response completes the turn; ToolSearch execution is untested. |

Claude's carrier is established by the controlled harness: the only supplied
stdin prompt is independently checked as the final text block and contains no
production instructions, Hooks are disabled, and no Skill or tool is invoked.
Reminder tags alone do not authenticate arbitrary user content. The parser
requires exact host envelope, Plugin scope, complete production text, independent
deferred discovery and host system contract. Regressions reject ordinary echo,
wrong scope, truncation, duplicate/extra prose, prompt contamination and already
loaded MCP schemas. The initial system-array-only assertion failed and its raw
capture was retained; the reviewed correction verifies this specific observed
host carrier without weakening complete-text acceptance.

Both successful captures retain raw requests, production initialize responses,
actual versions, semantic locations, zero tools/call evidence, tested Git revision,
dirty state and SHA-256 hashes of the test/adapter source. Codex uses temporary
CODEX_HOME isolation; Windows known-folder discovery can still read unrelated
Skill metadata, so the existing guard disables those Skills in temporary config
before creating a thread. Existing explicit Skill smokes also passed on these
versions; their fake process/CDP/upstream I/O boundary is separate from the new
adapter-only consumption fixture. These results establish host delivery, not
real-model adherence, automatic Skill matching or Desktop rendering, and do not
upgrade historical 0.161.0/2.1.294 acceptance records.

The packed Desktop references above identify files and branches without personal
installation paths; the local bundle has no public source URL. Static consumer
inspection does not prove ordinary gateway rendering or instruction adherence.

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
the full installed entry body and its isolation/occupancy/Close-Keep
instructions at that dated baseline; the harness does not copy the body into its prompt. After temporary
disable/reload, a distinct neutral thread has zero enabled Skills and lacks that
body and isolation section. Claude's explicit invocation also supplied the full
installed entry body at the captured model boundary. These historical smokes
establish explicit entry injection, not conditional reading of the question or
operation references introduced on 2026-10-13, locale selection or model adherence.

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
repository, the Skill title/short description/icons display in Plugin detail,
and the full long description renders. Tested Desktop version **26.1002.52244**,
build **13536**, production channel, came from official app metadata. The tested
source was
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

## Desktop Skill presentation study — 2026-10-09

This separate study covers Windows Codex Desktop **26.1002.52244**, build
**13536**, **prod**, identified by C5's packed app metadata. The 2026-10-09
user screenshots show this Plugin's custom icon in Plugin detail and the default
Skill glyph in the dollar picker. Packed source inspection explains the distinct
consumers; it does not extend the 2026-10-08 API or manual clicking checks.

| Presentation entry | Inspected consumer and result | UI evidence and remaining limits |
| --- | --- | --- |
| Plugin detail Skill row | `Ma` passes `interface.iconSmall`, `interface.iconLarge`, `basePath` and `smallOnly: true` to the image renderer. `yJr` reads `plugin/read` icon paths through `P2`, loads binary files and uses data URLs; PNG is supported. | The 2026-10-09 user screenshot shows this Plugin's custom PNG here, consistent with the 2026-10-08 manual Plugin detail acceptance. |
| Dollar picker Skill row | `ZOc` maps `galleryKind` through `CNe`/`TMe`, then assigns `Icon: wR(r)`. `wR` uses a fixed artifact-template-type map with a default builtin Skill glyph. The row still carries `iconSmall`; the `Icon: wR(r)` selection/rendering branch for ordinary Skills is independent of `interface.iconSmall`, `interface.iconLarge` and `brandColor`. | The 2026-10-09 user screenshot shows this Plugin's default glyph. Custom icon metadata validity does not establish picker rendering. |
| Selected Skill mention | `Ebr`'s skill-mention `toDOM` uses `wR(skillIcon ?? parsedAppearance.icon)` even though an `iconSmall` attribute exists. The inspected path uses builtin glyphs. | Source inspection only; manual selected-mention rendering was not verified. |

In `app-shared-40678a67f0e3.js`, `zRr` selects `artifact-template.json` only
for Skill names prefixed with `artifact-template-`; `RRr`/`LRr` parse its
`galleryKind`. Ordinary Skills do not take that template-kind branch. Documents
is another ordinary Skill with valid PNG `icon_small` that appears generic in
the user screenshots. Analytics Dashboard and Business Review are spreadsheet
and presentation artifact-template kinds with no `icon_small`; their colored
icons come from builtin type glyphs, not preview image files.

The existing [official Skill metadata documentation](https://learn.chatgpt.com/docs/build-skills#optional-metadata)
and C2's YAML/asset consumers establish metadata validity. This Plugin's existing
YAML and PNG remain valid and unchanged. The display restriction above comes
from C5's inspected renderer consumers, not an SVG requirement or a new metadata
contract. These observations are limited to this Desktop version and platform;
they do not establish a product bug or behavior across all versions/platforms.

## Native user-plugin management study — 2026-10-17

This study establishes the native CLI adapter and management service contract for
the direct HTTP payload above. App main and management-window integration remain
pending. The service does not advertise a production stable candidate: App and
Plugin 0.1.0 remain Unreleased. A missing candidate is a normal state.

Executed native versions were Codex **0.163.0** and Claude Code **2.1.302**.
Executables were selected explicitly for isolated acceptance. The adapter can
otherwise resolve only the known executable name from its launch environment's
PATH; it never scans drives, installs a CLI or probes a signed-in session. Each
operation uses a neutral existing cwd, structured executable/args/env and
`shell: false`, with hidden helper windows and bounded time/output. Unrecognized
native version or output metadata fails closed.

Config roots are explicit. Codex receives child-only `CODEX_HOME` and reads that
root's `config.toml`; Claude receives child-only `CLAUDE_CONFIG_DIR`, with optional
`CLAUDE_CODE_PLUGIN_CACHE_DIR` as a separate plugin-root override. App data is not
a host config root. Standard bounded TOML/JSON parsing extracts only the own
marketplace source/ref/pin and own user enablement. Unrelated settings, headers
and tokens are neither rewritten nor retained in management summaries/receipts.

Both adapters inventory only `debugging-cdp-targets`. Their adopted operations are:

| Operation | Codex | Claude Code |
| --- | --- | --- |
| Catalog inventory | `plugin marketplace list --json` | `plugin marketplace list --json` |
| Own Plugin inventory | `plugin list --marketplace debugging-cdp-targets --json` | `plugin list --json` |
| Add genuinely absent catalog | `plugin marketplace add SOURCE --json` | `plugin marketplace add SOURCE --scope user --json` |
| Selected catalog refresh | `plugin marketplace upgrade debugging-cdp-targets --json` | `plugin marketplace update debugging-cdp-targets --json` |
| Initial own install | `plugin add debugging-cdp-targets@debugging-cdp-targets --json` | `plugin install debugging-cdp-targets@debugging-cdp-targets --scope user --json` |
| Own user update | `plugin add debugging-cdp-targets@debugging-cdp-targets --json` | `plugin update debugging-cdp-targets@debugging-cdp-targets --scope user --json` |

Codex list supplies neither installed path nor scope. Marketplace `source.path`
is not an installed cache path. Only this service's safe native add result can
establish its actual `installedPath` receipt. Cold existing installations or
catalogs without adequate ownership evidence remain unresolved/read-only;
there is no add-as-probe or guessed cache adoption. Add enables the Plugin, so
explicit user `false` blocks it. Selected catalog upgrade can force-refresh other
entries even at the same version; unrelated, disabled, pinned or unresolved
copies block automatic refresh. Structured errors are checked even at exit 0.
Configured refs hidden by list output are read from the selected TOML config.

Claude list separates `scope`, `installPath` and optional `readFromFolder`.
In-place copies remain read-only. Both advertised cache and actual in-place roots
are physically compared across every returned own-Plugin scope. A user cache
shared with project, local, managed or another scope cannot be patched; explicit
user `false` overrides merged enablement. Same-version native update may do no
work, so the executed upgrade fixture used distinct versions.

Only Claude's exact installed-root `.in_use` directory is excluded from byte
comparison when it is readable, nonlinked, stable and empty. Nonempty, unreadable,
linked or changed markers remain in-use/read-only. The service neither deletes
nor decodes markers to acquire a lease. Canonical Git payloads forbid that root
marker. This exception follows the inspected 2.1.302 lease implementation; it
does not authorize arbitrary unknown installation metadata.

### Source, receipt and port synchronization boundaries

The minimal future latest record has schema 1, a stable Plugin version,
independent `minimumAppVersion`, Git URL and immutable lowercase 40-character
payload SHA. HTTPS sources cannot contain credentials, query or fragment;
loopback HTTP exists for isolated fixtures. Payload commit A precedes separately
authorized catalog/feed commit B. Both hosts' git-subdir catalogs must agree on
payload SHA, path and logical version. No history search or downgrade is used.

Before native effects, both catalog records and immutable source blobs are
validated without checkout, payload execution or Git hooks. Links, gitlinks,
escape and every case-folded file/directory-prefix alias are refused. After
native update, inventory must confirm the actual root, version, scope, source,
ref and enablement; exact full bytes, own manifest and transport are revalidated.
Only the proved `mcpServers['cdp-targets'].url` JSON literal may differ from source.
Headers, other entries, formatting and other files remain byte-identical.

A verified native replacement is checkpointed before later URL/persistence work.
Schema 1 management metadata stores actual paths/source, file hashes, original
strict loopback URL and unique UTF-8 byte offset. It stores no full MCP/header or
configuration mirror, bearer, connection or runtime state. Its explicit data
directory must already exist and be selected after App singleton admission.
Every restore and retry revalidates actual bytes and native/config ownership;
the service cannot absorb an external configuration change after its own command.
Explicit retry can finish a known replacement without repeating native update.
If its receipt never reached disk and the process is lost, a new instance lacks
that proof and remains read-only.

No candidate, an incompatible latest candidate or a stale older candidate does
not prevent a compatible, revalidated managed copy's new-port URL sync. Current
URL maintenance and update eligibility are independent. One host's failure does
not undo a successful peer. Atomic own writes check identity before effects and
read back immediately, including the narrow Claude lease check. No cross-process
compare-and-set spans config, catalog, native cache and URL rename; late movement
returns an explicit partial failure/retry. Disk/CLI success remains reload pending
until actual host activation is independently demonstrated.

The HTTP field/key basis matches maintained thin inputs: Codex `mcp.json` uses
`streamable-http`, Claude `.mcp.json` uses `http`, both own key `cdp-targets` and
default `http://127.0.0.1:27637/mcp`. The service accepts only a successfully bound
strict loopback `/mcp` endpoint for synchronization. Its CLI fixture supplies no
executable tools and does not establish App HTTP discovery or activation.

### Primary sources and executed scope

- Codex [Plugin packaging documentation](https://developers.openai.com/plugins/build/plugins)
    and matching [0.163.0 Plugin CLI](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/cli/src/plugin_cmd.rs),
    [Marketplace CLI](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/cli/src/marketplace_cmd.rs),
    [installation manager](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core-plugins/src/manager.rs#L2973),
    [loader](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core-plugins/src/loader.rs#L674)
    and [installed metadata](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core-plugin-common/src/installed.rs#L47)
    establish the separate catalog/add contracts and path evidence limits.
- Claude [CLI reference](https://code.claude.com/docs/en/plugins/cli-reference),
    [git-subdir source reference](https://code.claude.com/docs/en/plugins/marketplace-reference#git-subdir-plugin-source),
    [loading rules](https://code.claude.com/docs/en/plugins/loading) and
    [settings reference](https://code.claude.com/docs/en/settings) establish native
    user scope, source and enablement contracts.
- Local Claude 2.1.302 native JavaScript inspection at executable SHA-256
    `3ab075f78998efef8b87f491c2e4a39c309dddf44e51d0103eba4f3713d2a0ae`
    found `_m='.in_use'`, `Vde` PID/procStart markers, `Zho`/`g5` empty-directory
    retention and `Hb`/`yCt` unknown/nonempty-marker refusal. This is inspected
    local native source, not published source or a rendering/activation check.
- Executed Codex 0.163.0 executable SHA-256 was
    `2692c8c7bb2cf8b0aefe638741fc90236f4b824c59578ce84994f9de58200993`.
- Isolated native acceptance used separate temporary host homes/config roots,
    neutral cwd and loopback SMART HTTP Git remote with versions 0.1.11 → 0.1.12.
    Executed repository HEAD was `874d1a5d6a84727afb54d6a3911bc0653911dfd5`,
    with staged, uncommitted host-management changes at execution tree
    `180b6b965a1c7a8e9824cc5f3fd0814b86d852f0`; index and worktree matched.
    The later profile-fixture tree `40864bbadbbce6ea0369649338b1ecfe21fd4cc1`
    and private App-combination tree `183970c19e1259350d765e7b74164546d696a517`
    are separate source identities, not native reruns of those later trees.
    It proved actual installed-root replacement, preserved user intent,
    nondefault-port sync, disabled/ref/shared/unrelated-source refusal and
    independent host failure. A fresh manager with a null candidate resumed
    a verified receipt and changed port. A late URL failure after replacement
    and a stale candidate also recovered without a repeated native update.
    Fixture A1 was `767d4884950e802a3964a495185629b6df359dba`, B1
    `818209c061af791c7c60bfd225a5e08f5fec0c55`, A2
    `98bb51a80b30406d2cc73488ea7afb7f0f6ce26b` and B2
    `042046925e2bf138afde39c70ba4f1dbc2c675cd`. Logical transcript SHA-256 was
    `c3c78b97b56db394fd99a2a3c19d37827108068c4ebc3cd6eb9d10f9404fdd2d`;
    raw paths/transcript remain private. These fixture-only results do not prove
    actual installed thin App tools, concurrent host clients, registration
    context, reload activation, GUI or Desktop presentation. Those require
    separate current App acceptance.
