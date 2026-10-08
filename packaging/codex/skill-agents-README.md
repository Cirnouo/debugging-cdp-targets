# Codex Skill presentation

`openai.yaml` declares the Skill's display name, short description and icons.
It is Codex-only presentation metadata; the shared `SKILL.md` owns instructions.

For a PluginShared Skill, Codex resolves icons relative to the Skill directory,
`skills/debugging-cdp-targets/`, rather than this `agents/` directory. Both
`../../assets/icon.png` references use this Plugin's approved universal PNG.
The build and distribution audit allow only that exact reference and verify its
bytes against the maintained shared source. This rule applies only to this
PluginShared metadata and does not permit traversal in other Plugin paths.
