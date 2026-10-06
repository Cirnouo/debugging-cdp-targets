# Debugging CDP Targets for Codex

This complete Plugin launches and inspects verified local CDP targets through the
official Chrome DevTools MCP Server. It shares runtime and full Skill instructions
with the independent Claude Code distribution. Version 0.1.0 is unreleased.
Node 24.21.0 must be available as `node`; installed runtime needs no repository
dependencies or sibling Plugin. Actual installation and Hooks were accepted with
Codex CLI 0.160.0 on Windows.

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

Enable the Plugin MCP connection and invoke `$debugging-cdp-targets`. The gateway
starts with no target. Review/trust the four Hook definitions through Codex's
standard flow; installation does not grant Hook trust. Hooks deliver pending
exit/operation context at tool/turn boundaries, including one Stop continuation.

Refresh the Marketplace with `codex plugin marketplace upgrade debugging-cdp-targets`.
To uninstall, run `codex plugin remove debugging-cdp-targets@debugging-cdp-targets`,
then `codex plugin marketplace remove debugging-cdp-targets`.

`.codex-plugin/` owns the Codex manifest. `mcp.json` declares the portable MCP
schema and registers one reusable stdio gateway; `LICENSE` is the MIT grant.
`hooks/` contains automatic exit reminder Hooks, `skills/` contains Agent guidance,
and `dist/` contains bundled runtime files requiring no install in this directory.
Hook execution requires Codex's standard review and trust of each definition.

`dist/official-server/` delivers the unchanged official chrome-devtools-mcp 1.10.1
release, including its public Server bin, resources, licenses, vendor notices and
published skills. The gateway verifies all of these bytes before each launch.
Consumers need Node 24.21.0; package preparation is a contributor task.

See the [user guide](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/user-guide/README.md)
for detailed installation, compatibility, workflow, configuration, privacy and troubleshooting.
