# Requirements and compatibility

Version 0.1.0 is under development and has not been released.

## Requirements

- Codex with Plugin support, or Claude Code 2.1.283 or newer, and Node 24.21.0
    available on PATH. The Plugin includes the complete official
    `chrome-devtools-mcp@1.10.1` release; creating connections needs no npm/npx,
    pnpm, or dependency download.
- Internet access to obtain or update the Plugin. The installed Server can
    initialize its tool catalog offline; browser tools and visited pages may
    require network access.
- An application that supports an argument or environment configured debugging
    port and exposes a **browser-level Chrome DevTools Protocol (CDP) endpoint**.
    Chrome is the known-compatible target. Other CDP-capable applications are
    best effort; Electron, Tauri, or WebView2 alone does not establish compatibility.
- Linux and macOS require `ps` and `lsof`; Linux additionally requires `getconf`
    and readable `/proc` process evidence.

The Plugin controls only applications it launches and verifies. It does not
attach to already running browsers. Both the Plugin's CDP transport and the
target debugging endpoint must listen on loopback only. See
[configuration](configuration.md) for launch settings and
[privacy](privacy.md) for the security boundary.

## Plugin host acceptance

Actual Plugin installation, tool discovery and model-context Hooks were accepted
on Windows on 2026-10-05 with Codex CLI 0.160.0 and Claude Code 2.1.283. Claude
Code 2.1.283 is the first supported and accepted baseline. These explicit host
smokes use isolated configuration and loopback model fixtures; see
[the smoke instructions](../../tests/smoke/README.md) for commands and boundaries.
Each host receives a complete independent payload from the same maintained
runtime, Skill and verified official Server release.

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
establish acceptance of that later revision. See
[the smoke instructions](../../tests/smoke/README.md) for the test boundaries.
Other application/OS/browser combinations remain best effort.

## Chrome extension tools

Chrome extension tools require compatible Google Chrome 149 or newer. Their
presence in the tool catalog does not mean another application supports them.
The full advertised catalog also differs from each connection's enabled tools;
see [tool availability](configuration.md#official-tool-availability).

Continue with [installation](installation.md) or return to the [user guide](README.md).
