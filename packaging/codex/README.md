# Codex packaging inputs

`.codex-plugin/` owns the maintained Codex manifest and its directory documentation.
`mcp.json` declares the gateway; `hooks/` owns Codex automatic Hook definitions.
The manifest explicitly discovers `./skills/`. Flat `skill-openai.yaml` and
`skill-agents-README.md` inputs map through the host file inventory to the Skill's
`agents/openai.yaml` and `agents/README.md`. They add Codex-only presentation;
all shared Skill files remain byte-identical to their maintained inputs in both
hosts. Icon references use the existing approved Plugin-root universal PNG under
the narrowly audited PluginShared path rule documented in `skill-agents-README.md`.
`assets/` owns artwork directory documentation copied to the payload; the
approved universal and dark PNGs come from the explicit shared asset inventory.
The manifest's `interface.defaultPrompt` supplies three distinct single-line
starter prompts for screenshots, console/network diagnostics and page-load
performance. These prompts do not repeat the Skill name. The CLI smoke proves
that formal explicit Skill invocation supplies the complete installed instructions;
automatic Skill injection when selecting a Desktop starter prompt and Desktop
rendering remain pending manual acceptance. Local Plugin validation requires
three distinct nonempty single-line strings of at most 128
Unicode code points, matching the
[Codex 0.161.0 runtime loader](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/core-plugins/src/manifest.rs#L533-L551).
This limit applies when Codex loads the manifest.
`plugin-README.md` is copied as the installed payload README. This README documents
maintained inputs and stays in the repository. The build also copies shared
`packaging/shared/` assets, root `LICENSE` and the generated runtime map into
`plugins/codex/debugging-cdp-targets/`.
