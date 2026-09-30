# Bundled runtime

`mcp-bootstrap.mjs` and `control.mjs` are generated from source; they need no
Plugin-local install. `windows-cdp-helper.ps1` provides OS evidence, and
`hide-npm-console.cjs` hides acquisition subprocess consoles.
`THIRD-PARTY-NOTICES.txt` contains the bundled ws license. Do not edit generated
files directly; rebuild with pnpm build:plugin.
