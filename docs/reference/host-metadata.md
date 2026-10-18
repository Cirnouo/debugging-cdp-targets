# Host metadata for self-installation

Version 0.1.0 remains unreleased. The goal is useful, accurate metadata when
users add this repository's Marketplace and install either complete thin Host
Plugin. Public directory submission is outside this contract.

This reference describes the actual maintained manifests, catalogs, shared Skill
and Codex overlay. [Dated research and acceptance](../evidence/host-plugin-research.md#sources-and-evidence-levels)
own C1–C5, L1–L3 and M1 primary sources, tested versions and failures. Each
evidence level remains distinct: parsed metadata, source inspection, static
repository checks, executed CLI consumption and manual Desktop rendering.
[Host architecture](../architecture/host-plugin-management.md) owns synchronization.

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

## Adopted field matrix

Paths below identify maintained inputs from the repository root; generated peers
live in `plugins/<host>/debugging-cdp-targets/`. Required means needed for this
package's identity/wiring or selected quality contract, not a submission rule.
Source labels link the dated record; their version-limited findings are not new
UI acceptance. Current catalogs select local payload paths; no future git-subdir
feed or stable latest record is delivered for 0.1.0.

| Interface / fields | Consumer, defaults, path base and precedence | Adopted value or omission; necessity and reason | Evidence / boundary |
| --- | --- | --- | --- |
| Both `packaging/codex/.codex-plugin/plugin.json` and `packaging/claude-code/.claude-plugin/plugin.json`: `name`, `version`, `description`, `keywords` | Host package identity/discovery ([C1](../evidence/host-plugin-research.md#c1)/[L1](../evidence/host-plugin-research.md#l1)); no cross-host field equivalence is inferred. | `debugging-cdp-targets`, unreleased `0.1.0`; description `Connect Codex directly to the official Chrome DevTools MCP Server for a verified local CDP target.` or the same text with `Claude Code` replacing `Codex`; keywords `cdp`, `devtools`, `debugging`. Identity/version required; discovery text useful. | Repository and CLI; wording is not UI proof. |
| Both manifests: `author`, `repository`, `homepage`, `license` | Claude validates provenance/documentation fields ([L1](../evidence/host-plugin-research.md#l1)). Codex's inspected compatibility parser omits author/repository/homepage/license from its raw model ([C1](../evidence/host-plugin-research.md#c1)). | `author.name: Cirnouo`, `MIT`, repository and homepage both `https://github.com/Cirnouo/debugging-cdp-targets`; author email/url omitted because no additional contact contract is needed. Retain package provenance. | Repository; Codex compatibility loading does not consume these keys. Website UI requires the separate Codex interface field. |
| Codex manifest: `mcpServers`, `skills`; omitted `hooks` | [C1](../evidence/host-plugin-research.md#c1); explicit roots resolve from Plugin root; defaults are `skills/`, `.mcp.json`, `hooks/hooks.json`. A portable root `extensions.com.openai` replaces rather than merges the compatibility overlay. | Explicit `./mcp.json` and `./skills/`. No Hook file or field is delivered. `apps`/`onboardingSkill` omitted: no remote app or setup Skill. | Maintained manifest and thin-payload inventory; older Hook discovery is dated evidence. |
| Codex `interface`: `displayName`, `shortDescription`, `developerName`, `category` | [C1](../evidence/host-plugin-research.md#c1); separate Plugin interface metadata, not Skill presentation. | `Debugging CDP Targets`, `Inspect verified local CDP targets with Chrome DevTools`, `Cirnouo`, `Developer Tools`; useful presentation. | Returned through real `plugin/read`; these Plugin interface fields were not separately accepted in the manual Skill presentation check. |
| Codex `interface.websiteURL`, `longDescription` | [C1](../evidence/host-plugin-research.md#c1); `websiteURL` alias is consumed into the resolved interface and returned by the API. | Website is the exact project URL. Retained long description describes launching a new verified app, selected isolation, official tools and Close/Keep. It is adopted after actual Desktop rendering confirmation. | CLI confirms returned values; manual UI confirms website navigation and full long description. `homepage` alone is not this API consumer. |
| Codex `interface.defaultPrompt` | [C1](../evidence/host-plugin-research.md#c1); local resolver normalizes whitespace, keeps at most three prompts and drops entries over 128 Unicode scalar values. | Three existing distinct single-line prompts for screenshot, console/network and performance tasks. Project validator requires exactly three, nonempty, distinct, at most 128 Unicode code points; useful starters without duplicating the Skill name. | [0.161.0 resolver](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/manifest.rs#L533-L551); 0.160.0 has the same bound. Repository boundary tests accept 128 ASCII/non-BMP points and reject 129; CLI returns existing prompts. Automatic full Skill injection is unverified. |
| Codex `interface.logo`, `logoDark`, `composerIcon`, `composerIconDark` | [C1](../evidence/host-plugin-research.md#c1); `./` paths start at Plugin root. `logoDark` is recognized; inspected 0.160/0.161 compatibility raw/resolved interfaces have no `composerIconDark`. | Existing `./assets/icon.png` for base logo/composer, `./assets/icon-dark.png` for dark keys. Retain artwork and fields; no new asset profile or consumer. | Repository approved PNG/integrity checks are project quality, not public submission rules or UI proof. Existing dark composer key is ignored by this parser; individual manifest icon surfaces and dark-mode rendering were not manually verified. |
| Other Codex interface fields | [C1](../evidence/host-plugin-research.md#c1) supports optional presentation; existence does not create a package requirement. | `capabilities`, `screenshots`, `brandColor`, privacy/terms URLs omitted: no task need or separately supported content. | Deliberate omission; no publication contract adopted. |
| Claude `displayName`, `icon` | [L1](../evidence/host-plugin-research.md#l1); display title does not change Plugin namespace. Local loader ignores directory listing `icon` and listing URLs; unknown top-level fields may be stripped with warnings. | Display title `Debugging CDP Targets`; retain `./assets/icon.png`. Useful title/provenance; do not infer a local icon display consumer or add a dark field. | Manifest/cache CLI checks; icon presence is not local rendering evidence. |
| Claude component/config fields | [L1](../evidence/host-plugin-research.md#l1); defaults scan `skills/`, `.mcp.json`, `hooks/hooks.json`; explicit Skill paths add to defaults, MCP definitions merge with later names winning. `defaultEnabled` defaults true. | Explicit `skills`, `hooks`, `mcpServers`, `defaultEnabled`, settings/dependencies/userConfig/channels omitted. Defaults supply `skills/` and `.mcp.json` and enabled state; no Hooks are delivered; no new configuration contract. | Repository and executed CLI default discovery. |
| `.agents/plugins/marketplace.json` | [C1](../evidence/host-plugin-research.md#c1); catalog source path starts at Marketplace root, not `.agents/plugins/`; catalog and entry identity differ from display title. | Name `debugging-cdp-targets`, title `Debugging CDP Targets`; same entry name; local `./plugins/codex/debugging-cdp-targets`; `AVAILABLE` / `ON_INSTALL`, category `Developer Tools`. Required self-install pointer/policy. | Repository and selected local Marketplace CLI. Catalog authentication policy does not carry App credentials or establish registration ownership. |
| Codex installed manifest/Skill metadata | [C4](../evidence/host-plugin-research.md#c4); the host consumes its installed cache, independently from the tracked Marketplace snapshot. Source version selects the cache destination; a same-version Plugin add performs installation again. | Retain version `0.1.0`; refresh the catalog, then reinstall its current payload. See [installation](../user-guide/installation.md#update-or-uninstall-in-codex). Required to load updated metadata without confusing source freshness with cache freshness. | Versioned source and actual 0.161.0 same-version marker/stale-file/config fixture; dated full cache identity and [manual UI](../evidence/host-plugin-research.md#manual-desktop-acceptance). |
| `.claude-plugin/marketplace.json` | [L2](../evidence/host-plugin-research.md#l2); relative source starts at repository/Marketplace root. Entry display fields override manifest equivalents; manifest version wins; `strict` defaults true. | Same catalog/entry name, owner Cirnouo; existing catalog description and entry description matching Claude manifest; source `./plugins/claude-code/debugging-cdp-targets`. Entry displayName/version/components/category/tags/relevance omitted: leave title/version/components with one manifest owner. | Repository and CLI cache/install. No entry components means the strict component-conflict case is inapplicable. GitHub uses cached copies; local-directory loading alone does not prove GitHub cache/update behavior. |
| Shared `packaging/shared/skills/debugging-cdp-targets/SKILL.md` and `references/` | [C2](../evidence/host-plugin-research.md#c2)/[L3](../evidence/host-plugin-research.md#l3); discovery and explicit entry instructions. Claude defaults name to directory, description to first body line if absent; Plugin namespace qualifies invocation. | Existing frontmatter name/description, license MIT and metadata.version `0.1.0`; shared entry retains workflow and question rules, with common contract and language catalogues read only for a needed question. No host metadata changes; package license/version are not routing evidence. | Repository checks compare every maintained shared Skill file with both payloads in both directions. Historical host smokes captured entry-body injection; they do not establish conditional reference reads or language selection. |
| Codex `packaging/codex/skill-openai.yaml` | [C2](../evidence/host-plugin-research.md#c2); maps to `skills/debugging-cdp-targets/agents/openai.yaml`; interface is independent from Plugin interface. PluginShared icons resolve from Skill directory and are confined to this Plugin's assets. | Only interface: `display_name: Debugging CDP Targets`, `short_description: Debug verified local CDP targets`, both icon fields `../../assets/icon.png`. Useful Skill presentation using existing artwork. | Real YAML parser, exact overlay inventory/regular PNG byte checks; `skills/list` returns title/description/absolute icons. The 2026-10-08 manual check confirms Skill title/short description/icons in Plugin detail only. The separate [C5 Desktop study](../evidence/host-plugin-research.md#desktop-skill-presentation-study--2026-10-09) bounds picker and mention behavior. This traversal is not allowed for standalone Skills or generic manifest paths. |
| Skill invocation policy/dependencies/default prompt | [C2](../evidence/host-plugin-research.md#c2)/[L3](../evidence/host-plugin-research.md#l3) and [2026-10-09 research](../evidence/host-plugin-research.md#skill-and-mcp-research--2026-10-09); Codex implicit discovery defaults true; explicit selection still requires enablement. Claude defaults `disable-model-invocation: false`, `user-invocable: true`. | Codex policy, dependency declarations, Skill default prompt and brand color remain omitted. The thin Plugin already owns the complete HTTP wiring; no separate dependency installation or prefill is needed. Claude has no Codex YAML overlay or demonstrated local YAML consumer. `when_to_use`, `argument-hint` and `allowed-tools` remain omitted: the description covers discovery, no stable parameters or new preauthorization is needed. | Historical bootstrap-specific dependency reasoning remains dated. Discovery defaults do not authorize launch or prove matching/adherence. Static Try-prefill consumption does not prove UI clicking or full injection. |
| Codex `packaging/codex/mcp.json` | Schema 1.0.0 configuration, explicitly selected from Plugin root; [portable parser and cutover](#direct-http-cutover). | `mcpServers.cdp-targets`: `type: "streamable-http"`, `url: "http://127.0.0.1:27637/mcp"`. No command, args, cwd, headers or authentication field. | Actual [maintained HTTP input](../../packaging/codex/mcp.json); App must already be running. |
| Claude `packaging/claude-code/.mcp.json` | L1 default Plugin-root discovery and [official HTTP source](#direct-http-cutover). | `mcpServers.cdp-targets`: `type: "http"`, same default loopback URL; no command, args, cwd, headers or authentication field. | Actual [maintained HTTP input](../../packaging/claude-code/.mcp.json); no implicit Plugin-launched Server. |
| MCP initialize / tools | [HTTP request handler](../../src/adapters/mcp-request-handler.ts) creates both supported-era SDK Servers; initialization and package presentation are separate surfaces. | `name: debugging-cdp-targets`; version is the compiled App build version with unbundled fallback `0.1.0`. `tools: {}`, current HTTP registration instructions and request-state verifier; title/description/icons/websiteUrl omitted. Official metadata survives the required `_dct` schema extension; seven lifecycle tools retain their schemas. | Current [App HTTP contract](../app-runtime.md#http-and-authentication) and [lifecycle selectors](../lifecycle-protocol.md). Historical 689-byte paragraph, removed mcp-entry-server path and 73-tool captures remain dated evidence, not a current tool count or consumption claim. |

The retained `longDescription` is exactly:

> Launch a new local Chrome browser or another verified CDP-capable application with the isolation option you choose. Use the official Chrome DevTools tools to capture screenshots, diagnose console and network issues, and inspect performance. Choose Close or Keep when the task ends.

The retained Plugin starter strings are “Open https://example.com in a new Chrome
window and capture a screenshot.”, “Check console errors and failed requests in a
new Chrome window.” and “Profile page load performance in a new Chrome window.”
They are starter text, with explicit Skill invocation documented separately.

## Initialization instructions and evidence limits

Register takes no arguments. The current SDK paragraph requires one registration, explicit
registrationBearer on every owned call, `_dct` bearer/connection/session routing
for official tools, and retention of resources independently of chats and MCP
sessions. It forbids replaying start on reconnect and directs the Agent to the
Skill before launch and Close/Keep before ending target work. The handler owns
that exact text; package prompts do not duplicate it. Optional implementation
title, description, icons and websiteUrl remain omitted because no applicable
ordinary gateway presentation benefit was established by the dated research.
Modern request-state
verification is part of the current HTTP adapter. See [protocol compatibility](../lifecycle-protocol.md)
and the [dated 2026-10-17 host research](../evidence/host-plugin-research.md#mcp-protocol-compatibility-research--2026-10-17).

The historical namespace/search and reminder captures prove their original
instruction paragraph only. No current native host exchange, conditional Skill
reference read, locale choice, automatic invocation, modern envelope/Tasks flow
or new Desktop presentation is established by this documentation migration.
