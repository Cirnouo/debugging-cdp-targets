# Codex manifest

`plugin.json` identifies the thin Plugin, registers `./mcp.json` and selects
`./skills/`. Paths resolve from the Plugin root. The direct HTTP configuration
connects to the already running App; no Hooks or executable runtime are delivered.
`repository`, `homepage` and `interface.websiteURL` identify the GitHub project.
`interface` owns display text, artwork paths and starter prompts.

The full long description is retained on the basis of the dated manual Codex
Desktop 26.1002.52244 check. Historical stdio/Hook discovery and its exact limits
remain in [Host research evidence](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/evidence/host-plugin-research.md).
See the [current adopted metadata](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/reference/host-metadata.md)
for fields, current HTTP wiring and consumer boundaries.
