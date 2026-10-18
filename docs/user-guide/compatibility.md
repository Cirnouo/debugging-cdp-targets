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
[host metadata record](../evidence/host-plugin-research.md#mcp-protocol-compatibility-research--2026-10-17)
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

Claude Code 2.1.283 remains the first supported and accepted baseline. The
2026-10-05 Windows baseline used Codex CLI 0.160.0 and Claude Code 2.1.283;
later metadata, explicitly invoked Skill and Desktop checks are dated separately
in [Host research evidence](../evidence/host-plugin-research.md#executed-host-acceptance-and-its-limits).
Use explicit Skill invocation for complete instructions; selecting a starter
prompt has not been proved to inject the full body. Those stdio/Hook and
presentation checks do not establish current HTTP execution, App GUI or installer
acceptance. See the [current thin HTTP contract](../reference/host-metadata.md#direct-http-cutover).

## Desktop Chrome acceptance

The dated 2026-10-04 [desktop Chrome matrix](../mcp-native-validation.md#desktop-chrome-acceptance--2026-10-04)
covers Windows x64, Ubuntu/Xvfb x64 and macOS arm64 at its recorded versions.
It precedes the actual-exit revision in ADR 0013 and explicit isolation/connection
leases in ADR 0015, and establishes neither later change. Other combinations
remain best effort.

## Windows normal Close acceptance

The 2026-10-12 Windows x64 [normal Close controls](../tauri-close-validation.md#reproducible-independent-inputs)
cover independent Tauri, Chrome, Electron and gateway reuse at their recorded
versions. A framework label alone is insufficient: the Tauri fixture had an
explicit application/version data binding. These ordinary-integrity controls do
not establish new real UAC acceptance or every application's job/sandbox/broker
behavior. [Results, cleanup timing and earlier failures](../tauri-close-validation.md#application-results-and-cleanup-timing)
remain in that dated record.

## Windows Chrome window-state compatibility

Windows `targetKind: "chrome"` uses the fixed
[screenshot feature rule](configuration.md#windows-chrome-screenshot-feature).
The setting is a Chromium application feature; the fixed policy is scoped to
Windows Chrome. Generic applications and other platforms retain their launch
semantics and need independent verification. Normal window switching and
minimizing remain supported usage, without a foreground/minimize checklist.

The [2026-10-07 controlled comparison](../mcp-native-validation.md#controlled-chrome-window-state-follow-up-2026-10-07)
owns the measured six-combination and reverse-order results. Static-state
evidence does not establish every pending-capture transition, continuous
compositor occlusion, other Chrome versions or the historical Codex-click timeout's cause.
The measured version is acceptance scope, not a prelaunch version gate.

## Chrome extension tools

Chrome extension tools require compatible Google Chrome 149 or newer. Their
presence in the tool catalog does not mean another application supports them.
The full advertised catalog also differs from each connection's enabled tools;
see [tool availability](configuration.md#official-tool-availability).

Continue with [installation](installation.md) or return to the [user guide](README.md).
