<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="packaging/shared/assets/icon-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="packaging/shared/assets/icon-light.png">
        <img src="packaging/shared/assets/icon.png" alt="Debugging CDP Targets icon" width="128" height="128">
    </picture>
</p>

<h1 align="center">Debugging CDP Targets</h1>

<p align="center">
    Launch a separate local Chrome browser or another CDP-capable application and inspect it through the official Chrome DevTools MCP Server.
</p>

<p align="center">
    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/status-0.1.0%20unreleased-7c6f64?style=flat" alt="Status: 0.1.0 unreleased"></a>
    <a href="docs/user-guide/compatibility.md"><img src="https://img.shields.io/badge/Node-24.21.0-43853d?style=flat" alt="Node: 24.21.0"></a>
    <a href="https://github.com/ChromeDevTools/chrome-devtools-mcp"><img src="https://img.shields.io/badge/official%20Server-1.10.1-4285f4?style=flat" alt="Official Server: 1.10.1"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat" alt="License: MIT"></a>
</p>

Version 0.1.0 is under development and has not been released.

[Why use it](#why-use-it) · [Requirements](#requirements) · [Quick start](#quick-start) · [Workflow](#workflow) · [Start a task](#start-a-task) · [Documentation](#documentation)

## Why use it

- **A separate debugging target.** The Plugin launches and verifies its own local
    application. Chrome uses a dedicated debugging profile, separate from your usual
    browsing profile.
- **Official DevTools capabilities.** Inspect pages and styles, capture screenshots,
    diagnose network and console issues, and profile performance through the official
    Chrome DevTools MCP tools. Compatible Chrome also supports extension tools.
- **Independent connections.** One reusable gateway creates an independent MCP
    connection for each new target, without a fixed connection limit. Closing one
    target leaves the other connections usable.

## Requirements

- Codex with Plugin support, or Claude Code 2.1.283 or newer, with **Node 24.21.0**
    available on PATH. The complete official `chrome-devtools-mcp@1.10.1` release is
    bundled; installed connections need no npm/npx, pnpm, or dependency download.
- Chrome, or an application with a configurable debugging port and a **browser-level
    CDP endpoint**. Other applications are best effort; a framework name alone does
    not establish compatibility. Debugging endpoints must stay on loopback.
- Internet access to obtain or update the Plugin. Browser tools and visited pages
    may need network access. Linux/macOS require `ps` and `lsof`; Linux also requires
    `getconf` and readable `/proc` process evidence.

See [compatibility and dated acceptance results](docs/user-guide/compatibility.md)
for tested systems, host versions and extension requirements.

## Quick start

### Codex

Add the GitHub Marketplace source and install the Plugin:

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

Enable the Plugin's MCP connection in a new conversation and invoke
`$debugging-cdp-targets`. Enabling the connection does not launch a browser.
See the [Codex installation guide](docs/user-guide/installation.md#codex) for
Plugin browser installation, Hook trust, updates and removal.

### Claude Code

Add the GitHub Marketplace source and install the Plugin:

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

Restart Claude Code, then invoke `/debugging-cdp-targets:debugging-cdp-targets`.
The `cdp-targets` server starts with no target. See the
[Claude Code installation guide](docs/user-guide/installation.md#claude-code)
for `/plugin` installation, Hook controls, updates, scopes and removal.

### Workflow

1. Invoke your host's Skill and describe the application and debugging task. The
    Agent launches a separate target and verifies its process, listener and CDP
    endpoint. Existing applications are not taken over.
2. Inspect the target through the official DevTools tools.
3. Continue debugging through the same live connection, or reuse a kept live target
    for a follow-up task.
4. When finishing, choose **Close** or **Keep** when the Agent asks. Close requests
    normal shutdown; Keep retains the live target and connection for later work in
    the running gateway. There is no default or application force kill.

Chrome profiles remain after Close. Concurrent Chrome targets need distinct
`--user-data-dir` directories. Actual application exit retires its session; further
work requires a new start. See the [full workflow](docs/user-guide/workflow.md) for
reuse, explicit live restart and Hook notifications.

### Start a task

Invoke the Skill entry shown for your host above, then describe the task:

```text
Launch a separate Chrome debugging window and open https://example.com.
Inspect the page's network requests and console errors, and summarize what you find.
```

For a local page, supply its URL. For another CDP-capable application, provide its
executable path and documented debugging option if you know them. The Agent checks
the required endpoint before inspecting the application.

## Documentation

Start with the [user guide](docs/user-guide/README.md), or jump to a topic:

- [Installation](docs/user-guide/installation.md): host setup, Hooks, updates and removal.
- [Compatibility](docs/user-guide/compatibility.md): requirements and dated acceptance.
- [Workflow](docs/user-guide/workflow.md): launch, reuse, Close/Keep and live restart.
- [Configuration](docs/user-guide/configuration.md): structured launches, tools and workspaces.
- [Privacy](docs/user-guide/privacy.md): retained profiles, network access and dependency trust.
- [Troubleshooting](docs/user-guide/troubleshooting.md): recovery and minimized screenshots.

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately
through [SECURITY.md](SECURITY.md). [Repository documentation](docs/README.md) contains
the protocol, vocabulary, policies, decisions and validation evidence.
