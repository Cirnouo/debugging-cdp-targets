# Codex packaging inputs

`.codex-plugin/` owns the maintained Codex manifest and its directory documentation.
`mcp.json` declares the gateway; `hooks/` owns Codex automatic Hook definitions.
`assets/` owns artwork directory documentation copied to the payload; the
approved light and dark PNGs come from the explicit shared asset inventory.
`plugin-README.md` is copied as the installed payload README. This README documents
maintained inputs and stays in the repository. The build also copies shared
`packaging/shared/` assets, root `LICENSE` and the generated runtime map into
`plugins/codex/debugging-cdp-targets/`.
