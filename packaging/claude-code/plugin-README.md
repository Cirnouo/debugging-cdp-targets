# Debugging CDP Targets for Claude Code

This thin Plugin connects Claude Code directly to the separately launched
Debugging CDP Targets desktop App at `http://127.0.0.1:27637/mcp`. The App owns
verified new local CDP targets and their unchanged official Chrome DevTools MCP
Server connections. Version 0.1.0 is unreleased. Native installers remain under
development; contributors can build a verified local Windows stage using the
[App build instructions](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/app-runtime.md).

Launch the App first, then install the Plugin:

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

Restart Claude Code and invoke `/debugging-cdp-targets:debugging-cdp-targets`.
The `/plugin` interface is also a host-native installation entry. Follow the
Skill to register once and retain its private one-time bearer. Every owned call
explicitly carries that bearer; official `_dct` also carries current connection
and session identities. The App starts without a target. A chat or MCP session
disconnect does not close App-owned resources.

The Skill obtains isolation intent, researches directory binding and checks
occupancy before every launch. Ask Close/Keep before ending work. Close normally
ends only that connection; Keep retains its target and upstream. Directory
retention or preauthorized whole-directory cleanup follows the separately chosen
policy. The App's port setting takes effect after a successful normal restart;
if changed, align the host's native HTTP setting. No bearer is stored in the URL.

To update, run `claude plugin marketplace update debugging-cdp-targets`, then
`claude plugin update debugging-cdp-targets@debugging-cdp-targets` and restart
the host. To uninstall the Plugin, run
`claude plugin uninstall debugging-cdp-targets@debugging-cdp-targets`, then
`claude plugin marketplace remove debugging-cdp-targets`. Host uninstallation
does not close managed targets; use the App's normal Quit for that cleanup.

The payload contains `.claude-plugin/`, direct-HTTP `.mcp.json`, approved artwork,
the complete shared Skill and MIT `LICENSE`. It contains no runtime, Hooks,
official Server or dependency installation. The App supplies verified ordinary
Node and the complete original official release.

The manifest's homepage/title and historical local listing-icon limits are
documented with dated source and acceptance evidence in the
[host metadata record](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/host-metadata.md).
Historical Hook acceptance is not current HTTP acceptance. See the
[user guide](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/user-guide/README.md)
for workflow, requirements, configuration, privacy and troubleshooting.
