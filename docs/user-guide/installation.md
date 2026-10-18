# Installation

Use a host with Plugin support and launch the separate desktop App first. Each
host receives a thin payload with direct HTTP configuration, artwork and shared
Skill. It does not install Node, run scripts or launch a gateway. The App supplies
verified ordinary Node and the unchanged official Server. Version 0.1.0 remains
unreleased; native installers are pending. Contributors can build a verified local
Windows stage using the [App build instructions](../app-runtime.md#building-and-evidence).
The default App HTTP address is `http://127.0.0.1:27637/mcp`; host configuration
must match the effective App port. Host disconnect does not close managed targets.
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
Skill explicitly. The project website, Skill title/description/icons and full
long description passed manual acceptance on Codex Desktop 26.1002.52244. See
[host metadata evidence](../evidence/host-plugin-research.md) for consumers and limitations.

The thin Plugin contains no Hooks. Follow the Skill to register once and keep the
private bearer for explicit owned calls. Read lifecycle status/results directly.

### Update or uninstall in Codex

Refresh the GitHub Marketplace source, then reinstall the Plugin to refresh its
installed copy, including updates that retain version 0.1.0:

```powershell
codex plugin marketplace upgrade debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

The first command refreshes the catalog source; the second installs the current
payload into Codex's Plugin cache. A catalog refresh alone does not establish
that the installed files changed. Start a new conversation to use the updated
bundled Skills and tools. The same-version refresh was verified with Codex CLI
0.161.0; see [host metadata evidence](../evidence/host-plugin-research.md#codex-cache-refresh).

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

The thin Plugin contains no Hooks. The native host MCP connection goes directly
to the App. Use the shared Skill for registration, explicit routing and Close/Keep.

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

Uninstalling either host Plugin removes integration only. Use the App's normal
Quit to close managed targets and official children. Host Plugin update/uninstall
is separate from App delivery; this development stage provides no App background
updater or native uninstaller. Continue with the [workflow](workflow.md) or return
to the [user guide](README.md).
