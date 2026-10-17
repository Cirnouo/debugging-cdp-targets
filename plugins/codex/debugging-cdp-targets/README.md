# Debugging CDP Targets for Codex

This thin Plugin connects Codex directly to the separately launched Debugging
CDP Targets desktop App at `http://127.0.0.1:27637/mcp`. The App launches verified
new local CDP targets and relays the unchanged official Chrome DevTools MCP
Server. Version 0.1.0 is unreleased. Native installers remain under development;
contributors can build a verified local Windows stage using the repository's
[App build instructions](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/app-runtime.md).

Launch the App first, then install the Plugin:

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

In a new conversation, enable its MCP connection and explicitly invoke
`$debugging-cdp-targets`. The App starts with no target. Follow the Skill to
register once, retain the private one-time bearer and explicitly route every
owned call. Conversations and MCP connections do not implicitly own targets.
Disconnecting the host does not close them. Ask Close/Keep before ending work;
Close normally ends that connection, while Keep preserves its target and upstream.

The Skill obtains isolation intent, researches application-specific directory
binding and checks occupancy before every launch. Directory retention or
preauthorized whole-directory cleanup is independent of Close/Keep. The App
provides a management window for HTTP port and appearance. A changed port becomes
effective after a successful normal App restart; update the host's native HTTP
setting to the same port. The default Plugin URL contains no credential.

To refresh the installed payload, including an unreleased same-version build:

```powershell
codex plugin marketplace upgrade debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

Start a new conversation after updating. To uninstall the Plugin, run
`codex plugin remove debugging-cdp-targets@debugging-cdp-targets`, then
`codex plugin marketplace remove debugging-cdp-targets`. This removes host
integration; use the App's normal Quit to close its managed resources.

The payload contains `.codex-plugin/`, portable direct-HTTP `mcp.json`, approved
artwork, the complete shared Skill and MIT `LICENSE`. It contains no executable
runtime, Hooks, Node installation, official Server or dependency scripts. The
App delivers its own verified ordinary Node and original official release.

Explicit Skill invocation is the established full-instruction entry. Dated CLI
metadata and historical Desktop icon observations, their host versions and
presentation limits are recorded in the
[host metadata record](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/host-metadata.md).
They do not establish new Desktop rendering acceptance for this HTTP cutover.
See the [user guide](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/user-guide/README.md)
for workflow, compatibility, privacy and troubleshooting.
