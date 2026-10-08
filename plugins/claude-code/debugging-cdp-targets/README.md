# Debugging CDP Targets for Claude Code

This complete Plugin connects Claude Code to the unchanged official Chrome
DevTools MCP Server through one reusable gateway. Version 0.1.0 is unreleased;
Claude Code 2.1.283 is the first supported and accepted host baseline. Node 24.21.0
must be available as `node`. No repository dependencies or sibling Plugin are
needed after installation.

The 2026-10-08 metadata follow-up passed Marketplace installation and all eight
Hook/Skill scenarios on Windows with Claude Code 2.1.294, including the complete
explicitly invoked Skill body at the loopback model boundary. The historical
2.1.283 baseline was not rerun. The manifest supplies the project homepage and
display title; its retained listing icon has no established local loader display
effect. See the
[host metadata record](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/host-metadata.md)
for consumer support and evidence limits.

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

You can also install through Claude Code's `/plugin` interface. For local
acceptance, use the repository directory as the Marketplace source. Restart the
host after installing or updating the Plugin. Enabling the Plugin loads its
default Hooks unless the effective host setting `disableAllHooks` is true.

To update, refresh the Marketplace with
`claude plugin marketplace update debugging-cdp-targets`, then run
`claude plugin update debugging-cdp-targets@debugging-cdp-targets` and restart.
To uninstall, run `claude plugin uninstall debugging-cdp-targets@debugging-cdp-targets`,
then `claude plugin marketplace remove debugging-cdp-targets`.

Invoke `/debugging-cdp-targets:debugging-cdp-targets` for the complete workflow.
The `cdp-targets` server exposes seven lifecycle tools and the official tools;
each target gets an independent connection. Every official call requires
`_dct` routing with current connection and session identity. Lifecycle requests
identify the gateway with `entryId`. Ask Close or Keep before ending the target
task. Keep retains the target and upstream; Close
normally ends only that connection.

The Skill asks isolation intent and checks occupancy before every launch in
both modes. Chrome's old profile location remains an explicit preset choice;
there is no automatic profile fallback. Directory cleanup follows its already
chosen retention/deletion policy, independently of Close/Keep.

- `.claude-plugin/` identifies the Plugin.
- `.mcp.json` starts `dist/mcp-bootstrap.mjs` using CLAUDE_PLUGIN_ROOT.
- `hooks/` handles pending operation results, connection errors and active-task reminders.
- `skills/` contains the shared complete instructions.
- `dist/` contains the runtime, native helpers, notices and complete official Server.
- `LICENSE` contains the shared MIT license.

See the [user guide](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/user-guide/README.md)
for detailed installation, compatibility, workflow, configuration, privacy and troubleshooting.
