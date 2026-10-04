# Debugging CDP Targets for Claude Code

This complete Plugin connects Claude Code to the unchanged official Chrome
DevTools MCP Server through one reusable gateway. Version 0.1.0 is unreleased;
Claude Code 2.1.283 is the supported host baseline. Node 24.21.0
must be available as `node`. No repository dependencies or sibling Plugin are
needed after installation.

Add this repository as a Claude Code Plugin marketplace and install
`debugging-cdp-targets@debugging-cdp-targets` through the host Plugin UI. For local
acceptance, use the repository directory as the marketplace source. Restart the
host after installing or updating the Plugin. Enabling the Plugin loads its
default Hooks unless the host setting `disableAllHooks` is true.

Invoke `/debugging-cdp-targets:debugging-cdp-targets` for the complete workflow.
The `cdp-targets` server exposes seven lifecycle tools and the official tools;
each target gets an independent connection. Every official call requires
`_dct` routing with current connection and session identity. Lifecycle requests
identify the gateway with `entryId`. Ask Close or
Keep before ending the target task. Keep retains the target and upstream; Close
normally ends only that connection.

- `.claude-plugin/` identifies the Plugin.
- `.mcp.json` starts `dist/mcp-bootstrap.mjs` using CLAUDE_PLUGIN_ROOT.
- `hooks/` handles pending operation results, connection errors and active-task reminders.
- `skills/` contains the shared complete instructions.
- `dist/` contains the runtime, native helpers, notices and complete official Server.
- `LICENSE` contains the shared MIT license.
