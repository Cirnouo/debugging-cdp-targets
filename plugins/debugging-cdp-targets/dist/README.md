# Bundled runtime

`mcp-bootstrap.mjs` and `control.mjs` are generated from source; they need no
Plugin-local install. `windows-cdp-helper.ps1` provides OS evidence.
`THIRD-PARTY-NOTICES.txt` contains licenses for all bundled third-party packages,
including the official MCP SDK packages, their dependencies, and verified vendored code.
Do not edit generated files directly; rebuild with pnpm build:plugin.

`official-server/` contains the complete unchanged official npm release, including
its Apache-2.0 LICENSE, bundled vendor notices, resources and published skills.
The build checks every published file against maintained release evidence; pnpm's
installation-only bin shims are never copied. This verified third-party subtree
retains upstream formatting and documentation. Its JavaScript is syntax-checked.
