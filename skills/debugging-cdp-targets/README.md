# Debugging CDP Targets payload

This directory is the complete installable Skill and owns its runtime-facing
instructions and implementation.

- `SKILL.md` is the agent entry point and Start → Inspect → Finish workflow.
- `LICENSE` is the payload's MIT license.
- `agents/` owns agent-interface metadata.
- `references/` owns target-specific operational guidance.
- `scripts/` owns the portable runtime, domain policies, and external adapters.

The sole executable Node entry is `scripts/cdp-session.mjs`.
