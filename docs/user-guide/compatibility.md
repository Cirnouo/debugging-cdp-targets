# Requirements and compatibility

Version 0.1.0 is under development and has not been released.

## Requirements

- Codex with Plugin support or Claude Code with native HTTP MCP support, plus
    the separately running App. The App includes verified ordinary Node and the
    complete original `chrome-devtools-mcp@1.11.0`; thin Plugins need no runtime
    dependency installation. See [current build/platform limits](../app-runtime.md#building-and-evidence).
- Internet access to obtain or update the Plugin. The installed Server can
    initialize its tool catalog offline; browser tools and visited pages may
    require network access.
- An application that supports an argument or environment configured debugging
    port and exposes a **browser-level Chrome DevTools Protocol (CDP) endpoint**.
    Chrome is the known-compatible target. Other CDP-capable applications are
    best effort; Electron, Tauri, or WebView2 alone does not establish compatibility.
- Linux and macOS require `ps` and `lsof`; Linux additionally requires `getconf`
    and readable `/proc` process evidence.
- Windows launch requires Windows 10 / Windows Server 2016 or newer for atomic
    native job assignment through `PROC_THREAD_ATTRIBUTE_JOB_LIST`. Failure to
    create or observe the owned job leaves launch/cleanup failed rather than
    falling back to an unobserved application. See Microsoft's
    [process-creation attribute contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).

The Plugin controls only applications it launches and verifies. It does not
attach to already running browsers. Both the Plugin's CDP transport and the
target debugging endpoint must listen on loopback only. See
[configuration](configuration.md) for launch settings and
[privacy](privacy.md) for the security boundary.

For contributors, Node 24.21.0 is the exact CI and problem-reproduction baseline. Existing
stable Node 24 installations at or above that floor are supported; newer major
versions and prereleases are outside the supported range. Contributors use
exact pnpm 12.4.2; installed Plugin users do not need pnpm. See
[contributor setup](../../CONTRIBUTING.md#prepare-a-checkout) for optional mise
selection and [ADR 0016](../adr/0016-toolchain-compatibility.md) for the policy.

## MCP protocol compatibility

The App's direct HTTP endpoint supports strict MCP 2026-07-28 and sessionful
legacy clients through the same fixed tool catalog. The Plugin URL and explicit
registration bearer/route stay the same. Modern roots and form input use standard
request continuation; legacy negotiated roots/elicitation remain supported.
Optional progress follows the active response and stops with it. Continue using
`dct_operation_wait` for lifecycle completion and results; MCP Tasks is not required.

Fixed-version research dated 2026-10-17 finds Codex 0.163.0 uses legacy by default;
Claude Code 2.1.302 documents modern negotiation with runtime conditions. The
[host metadata record](../host-metadata.md#mcp-protocol-compatibility-research--2026-10-17)
owns primary links and distinguishes source support, SDK regressions and actual
host acceptance. Native background tasks do not prove MCP Tasks support, and no
experimental host flag is needed for this compatibility path.

## Launch and isolation compatibility

The Agent checks application/version, documented CDP startup and read-only
occupancy before every new launch in both modes. All targets are conservatively
treated as same-effective-data-directory singletons, without researching a
singleton API or exempting multi-instance applications. Known same-root/shared
use, uncertain attribution of a related running app and incomplete inspection
leave the request unlaunched. Complete related-app absence can clear a generic
point-in-time gate subject to applicable locks; directory uniqueness alone cannot.
Generic occupancy is an Agent workflow requirement. Runtime retains native
known-root Chrome checks rather than a universal generic/default-root resolver.

Requested isolation needs application/version-specific official docs/source,
read-only installation facts and applicable evidence for covered state and
remaining production effects. Full support proceeds; partial asks acceptance or
none; unsupported informs and remains unlaunched; unknown continues research.
A framework or one directory switch alone does not establish isolation.
The verified application binding must be expressible in args/env with `{dataDir}`;
cwd-only application isolation is a Plugin expression limitation.

Regular Chrome 136+ rejects remote-debugging port/pipe for its default production
directory even when free. None must stay unlaunched for that documented combination
rather than silently selecting isolation. Chrome for Testing retains earlier
behavior; other brands and versions need applicable evidence. See
[Chrome's remote-debugging change](https://developer.chrome.com/blog/remote-debugging-port).
See [workflow](workflow.md) for the explicit Chrome preset and ordered directory
choices, and [configuration](configuration.md#ports-and-data-directories) for
effective-root/policy/environment and runtime enforcement limits.

## Plugin host acceptance

The records below describe the dated stdio/Hook architecture and presentation
checks before the HTTP cutover. They do not establish current HTTP execution,
new App GUI or installer acceptance. Current HTTP contracts and evidence limits
are owned by [host metadata](../host-metadata.md#direct-http-cutover).

Actual Plugin installation, tool discovery and model-context Hooks were accepted
on Windows on 2026-10-05 with Codex CLI 0.160.0 and Claude Code 2.1.283. Claude
Code 2.1.283 is the first supported and accepted baseline. These explicit host
smokes use disposable configuration and loopback model fixtures; see
[the smoke instructions](../../tests/smoke/README.md) for commands and boundaries.
Those historical payloads each included runtime and the official release.
Current payloads are thin and share the separately running App.

The metadata follow-up on 2026-10-08 passed both Marketplace smokes and all eight
Hook/Skill scenarios per host with actual Codex CLI 0.161.0 and Claude Code
2.1.294. It verifies installed metadata/bytes and full explicitly invoked Skill
instructions at the loopback model boundary; the older versions were not rerun.
Codex resolves the installed Skill as `debugging-cdp-targets:debugging-cdp-targets`
with user scope and separate Plugin provenance. Windows may read global Skills
during discovery before temporary path disables, while model threads are guarded
to the fixture enabled set. Child Git transport restrictions still permit
in-process public catalog HTTP fallback. No personal config/global Skill is
modified. This is not OS-profile, no-read or complete network isolation.

On 2026-10-08, manual acceptance on Codex Desktop 26.1002.52244, build 13536,
prod, confirmed project website navigation, Skill title/short description/icons
and the full long description at source ebcd580. The installed cache matched all
380 files from that pinned source before the human checked the UI. Automatic
starter prompt injection and dark-mode-specific rendering remain unverified.
See the [host metadata record](../host-metadata.md) for primary sources, cache
preparation evidence and the exact manual scope.

## Desktop Chrome acceptance

Real desktop Chrome acceptance passed on the following systems on 2026-10-04:

| Operating system | Architecture | Chrome version |
| --- | --- | --- |
| Windows, OS build 10.0.26300 | x64 | 154.0.8037.98 |
| Ubuntu 24.04.5 LTS with Xvfb | x64 | 154.0.8037.57 |
| macOS 15.7.9 | arm64 | 152.0.7977.83 |

The Linux and macOS evidence comes from GitHub's `ubuntu-24.04` and `macos-15`
runners. The acceptance checks cover official page/CSS tools, concurrent
independent connections, Keep/reuse, scoped Close, same-port recovery, stale
sessions and exit cleanup. These dated results precede the actual-exit lifecycle
revision in [ADR 0013](../adr/0013-session-owned-exit-cleanup.md); they do not
establish acceptance of that later revision or the explicit isolation/connection
lease change in [ADR 0015](../adr/0015-explicit-data-directory-isolation.md). See
[the smoke instructions](../../tests/smoke/README.md) for the test boundaries.
Other application/OS/browser combinations remain best effort.

## Windows normal Close acceptance

On 2026-10-12, Windows 11 Home, Chinese edition, x64, native version
`10.0.26300` / build `26300`, passed new independent Tauri, Chrome, Electron
and Chrome-reuse controls on one delivered gateway with Node 24.21.0 and the
unchanged official Server 1.10.1:

| Application fixture | Actual runtime |
| --- | --- |
| Tauri sample 0.1.0 | Tauri 2.12.3, Wry 0.57.0, Tao 0.37.1, WebView2 154.0.4258.62 |
| Chrome, including final gateway reuse | 155.0.8059.40 |
| Electron sample | Electron 44.5.1, Chromium 152.0.7977.130, Node 24.21.0 |

Each normal Close verified actual native root exit, zero active processes in the
owned native job, whole-directory deletion, updated original start metadata,
an empty registry and a live gateway for the next connection. Final gateway
stdin EOF exited normally with code 0. The anonymous job has no kill-on-close
flag or process limits; native root exit still revokes routes immediately while
resource cleanup waits separately. These real controls establish the tested
Chrome/Electron nested-job compatibility, not every application or sandbox.

The Tauri fixture has explicit application/version-specific data binding.
This evidence does not turn arbitrary Tauri, Electron or WebView2 applications
into universally compatible targets. The job covers inherited descendants,
including later generations, and excludes unrelated processes and arbitrary
external brokers. These ordinary-integrity runs do not establish new real UAC
acceptance. Earlier failed cleanup evidence and retained directories remain
documented separately in the
[dated Close validation](../tauri-close-validation.md#application-results-and-cleanup-timing).

## Windows Chrome window-state compatibility

Windows `targetKind: "chrome"` uses the fixed
[screenshot feature rule](configuration.md#windows-chrome-screenshot-feature).
The underlying setting is a Chromium application feature; the Plugin's fixed
policy is scoped to Windows Chrome. Generic applications and other platforms
retain their existing launch semantics and require independent verification.

The 2026-10-07 controlled comparison measured Chrome 154.0.8037.98 on Windows
with the unchanged official Server 1.10.1. All six candidate combinations of
foreground-normal, background-normal and minimized windows with viewport and
fullPage capture produced correct screenshots. Minimized viewport baseline
timed out while the candidate succeeded in both acquisition orders. Both
background baseline modes and minimized fullPage baseline already succeeded.

These are measured static-state results, not proof of every transition during a
pending capture, continuous compositor occlusion, another Chrome version or the
historical Codex-click timeout's cause. Normal user window switching and
minimizing remain supported usage; no foreground/minimize checklist is added.
The measured version is acceptance scope, not a prelaunch version gate. See
[the dated validation record](../mcp-native-validation.md#controlled-chrome-window-state-follow-up-2026-10-07)
for exact inputs, reverse contrast, cleanup and remaining delivery gates.

## Chrome extension tools

Chrome extension tools require compatible Google Chrome 149 or newer. Their
presence in the tool catalog does not mean another application supports them.
The full advertised catalog also differs from each connection's enabled tools;
see [tool availability](configuration.md#official-tool-availability).

Continue with [installation](installation.md) or return to the [user guide](README.md).
