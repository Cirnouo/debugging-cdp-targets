# Bundled runtime

`mcp-bootstrap.mjs` and `control.mjs` are generated from source; they need no
Plugin-local install. `windows-cdp-helper.ps1` provides OS evidence, and
`hide-npm-console.cjs` hides acquisition subprocess consoles.
`THIRD-PARTY-NOTICES.txt` contains licenses for all bundled third-party packages,
including the official MCP SDK packages, their dependencies, and verified vendored code.
Do not edit generated files directly; rebuild with pnpm build:plugin.
