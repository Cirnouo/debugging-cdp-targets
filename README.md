<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="packaging/shared/assets/icon-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="packaging/shared/assets/icon-light.png">
        <img src="packaging/shared/assets/icon.png" alt="Debugging CDP Targets icon" width="128" height="128">
    </picture>
</p>

<h1 align="center">Debugging CDP Targets</h1>

<p align="center">
    Launch a separate local CDP target and debug it through the official Chrome DevTools MCP Server.
</p>

<p align="center">
    <a href="CHANGELOG.md">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/status-0.1.0%20unreleased-0e7490?style=flat&amp;labelColor=334155">
            <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/status-0.1.0%20unreleased-07849e?style=flat&amp;labelColor=46545b">
            <img src="https://img.shields.io/badge/status-0.1.0%20unreleased-07849e?style=flat&amp;labelColor=46545b" alt="Status: 0.1.0 unreleased">
        </picture>
    </a>
    <a href="docs/user-guide/compatibility.md">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Node-24.21.0-0e7490?style=flat&amp;labelColor=334155">
            <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/Node-24.21.0-07849e?style=flat&amp;labelColor=46545b">
            <img src="https://img.shields.io/badge/Node-24.21.0-07849e?style=flat&amp;labelColor=46545b" alt="Node: 24.21.0">
        </picture>
    </a>
    <a href="https://github.com/ChromeDevTools/chrome-devtools-mcp">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/official%20Server-1.10.1-0e7490?style=flat&amp;labelColor=334155">
            <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/official%20Server-1.10.1-07849e?style=flat&amp;labelColor=46545b">
            <img src="https://img.shields.io/badge/official%20Server-1.10.1-07849e?style=flat&amp;labelColor=46545b" alt="Official Server: 1.10.1">
        </picture>
    </a>
    <a href="LICENSE">
        <picture>
            <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/license-MIT-0e7490?style=flat&amp;labelColor=334155">
            <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/license-MIT-07849e?style=flat&amp;labelColor=46545b">
            <img src="https://img.shields.io/badge/license-MIT-07849e?style=flat&amp;labelColor=46545b" alt="License: MIT">
        </picture>
    </a>
</p>

<p align="center">Version 0.1.0 is under development and has not been released.</p>

<p align="center"><a href="#why-use-it">Why use it</a> · <a href="#requirements">Requirements</a> · <a href="#quick-start">Quick start</a> · <a href="#start-a-task">Start a task</a> · <a href="#documentation">Documentation</a></p>

## Why use it

- **Separate targets.** Launch a new local application and verify its process and CDP endpoint.
- **Official DevTools.** Inspect pages, capture screenshots, diagnose network and console issues,
    and profile performance.
- **Independent connections.** Each target gets its own MCP connection; closing one leaves the
    others usable.

## Requirements

- **Node 24.21.0** on PATH.
- **Codex with Plugin support**, or **Claude Code 2.1.283+**.
- **Chrome**, or another application with a **browser-level CDP endpoint**.

See [full requirements and tested platforms](docs/user-guide/compatibility.md).

## Quick start

### Codex

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

In a new conversation, enable the Plugin's MCP connection and invoke
`$debugging-cdp-targets`. [Installation details](docs/user-guide/installation.md#codex).

### Claude Code

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

Restart Claude Code and invoke `/debugging-cdp-targets:debugging-cdp-targets`.
[Installation details](docs/user-guide/installation.md#claude-code).

### Start a task

After invoking your host's Skill, describe the task:

```text
Launch a separate Chrome debugging window and open https://example.com.
Inspect the page's network requests and console errors, and summarize what you find.
```

## Documentation

Explore the [user guide](docs/user-guide/README.md):

[Installation](docs/user-guide/installation.md) · [Compatibility](docs/user-guide/compatibility.md) · [Workflow](docs/user-guide/workflow.md) · [Configuration](docs/user-guide/configuration.md) · [Privacy](docs/user-guide/privacy.md) · [Troubleshooting](docs/user-guide/troubleshooting.md)

---

<p align="center">
    <sub><a href="CONTRIBUTING.md">Contributing</a> · <a href="SECURITY.md">Security</a> · <a href="docs/README.md">Documentation index</a></sub>
</p>
