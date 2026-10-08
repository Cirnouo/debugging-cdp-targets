# Installation

Use a host with Plugin support and Node 24.21.0 available on PATH. Each host
receives a complete independent payload from the same maintained runtime, Skill
and verified official Server release. Installed connections need no npm/npx,
pnpm, repository dependencies or sibling Plugin. Version 0.1.0 is unreleased.
See [compatibility](compatibility.md) for prerequisites and tested host versions.

## Codex

Add the public GitHub repository as a Marketplace source, then install the Plugin:

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

You can also install it from Codex's Plugin browser after adding the source.
Enable the Plugin's MCP connection in a new conversation, then invoke
`$debugging-cdp-targets` with the application and task you want to inspect.
Enabling the connection does not launch a browser automatically.

The installed Plugin declares a project website and separate Skill title,
description and icons. Actual Codex CLI 0.161.0 inspection accepted those values
and formal explicit Skill invocation loaded the complete instructions. Selecting
a Desktop starter prompt has not been proved to load the same body; invoke the
Skill explicitly. Website navigation, Skill presentation and the candidate long
description remain pending manual Desktop acceptance. See
[host metadata evidence](../host-metadata.md) for consumers and limitations.

### Codex Hooks

Enable Hooks and review the installed definitions through Codex's standard trust
flow. Installing the Plugin does not trust its Hooks. The isolated acceptance
checks both trusted and untrusted definitions; see
[Codex Hooks](https://learn.chatgpt.com/docs/hooks).
See [automatic notifications](workflow.md#automatic-notifications) for delivery
timing and the events they provide.

### Update or uninstall in Codex

Refresh the GitHub Marketplace source with:

```powershell
codex plugin marketplace upgrade debugging-cdp-targets
```

To uninstall, remove the Plugin before removing its Marketplace source:

```powershell
codex plugin remove debugging-cdp-targets@debugging-cdp-targets
codex plugin marketplace remove debugging-cdp-targets
```

## Claude Code

Claude Code 2.1.283 is the first supported and accepted baseline. Add the public
GitHub repository as a Marketplace source, then install the Plugin:

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

The Plugin also appears in Claude Code's `/plugin` interface after adding the
Marketplace. Restart Claude Code after installation. Invoke
`/debugging-cdp-targets:debugging-cdp-targets` with the application and task.
The installed `cdp-targets` server starts with no target; the Skill launches an
explicitly selected application.

For an unreleased contributor checkout, pass its absolute repository directory
to `claude plugin marketplace add`.

### Claude Code Hooks

Review the Plugin before installing or enabling it. Enabled Plugin Hooks are
discovered from `hooks/hooks.json`; they call the scoped server
`plugin:debugging-cdp-targets:cdp-targets`. Check `/hooks` to inspect active
definitions. An effective `disableAllHooks: true` setting disables their
execution while the Plugin MCP server can remain connected. Plugin enablement
and these settings are Claude's controls; see
[Claude Hooks](https://code.claude.com/docs/en/hooks).
Lifecycle events require Hooks to execute in the current host. See
[automatic notifications](workflow.md#automatic-notifications) for their behavior.

### Update or uninstall in Claude Code

Refresh the Marketplace and update the installed Plugin, then restart Claude Code:

```powershell
claude plugin marketplace update debugging-cdp-targets
claude plugin update debugging-cdp-targets@debugging-cdp-targets
```

To uninstall, remove the Plugin before removing its Marketplace source:

```powershell
claude plugin uninstall debugging-cdp-targets@debugging-cdp-targets
claude plugin marketplace remove debugging-cdp-targets
```

Installation and uninstallation default to user scope; updates automatically
detect the installation scope. Claude also supports project/local scopes; select
the matching scope when updating or removing those installations. See the
[Claude Marketplace reference](https://code.claude.com/docs/en/plugin-marketplaces).

Continue with the [workflow](workflow.md) or return to the [user guide](README.md).
