# 0012 — Peer Codex and Claude Code distributions

Status: accepted for unreleased 0.1.0.

Codex and Claude Code need independent installable Plugins with host-specific
metadata and Hook discovery, while target identity, lifecycle, official tools,
routing and reviewed release evidence remain common. Maintain one runtime in
`src/`, one complete host-neutral Skill and distribution documentation in
`packaging/shared/`, and explicit host inputs in `packaging/codex/` and
`packaging/claude-code/`. Build the runtime once and assemble complete committed
payloads under `plugins/codex/debugging-cdp-targets/` and
`plugins/claude-code/debugging-cdp-targets/`.

The payload-internal host paths follow host interfaces. Codex retains
`.codex-plugin/plugin.json`, relative `mcp.json` startup/cwd and an explicit Hook
reference. Claude follows its [official Plugin layout](https://code.claude.com/docs/en/plugins-reference):
`.claude-plugin/plugin.json`, default `.mcp.json`, `skills/` and `hooks/hooks.json`,
with `${CLAUDE_PLUGIN_ROOT}` for startup. Default Claude Hooks are not re-declared
in its manifest. Its MCP Tool Hooks use the scoped server
`plugin:debugging-cdp-targets:cdp-targets`. The `packaging/` input/output split and
`plugins/<host>/` hierarchy are repository maintenance conventions, not host
requirements.

Complete physical copies increase committed distribution bytes but allow either
host to install independently with every runtime resource inside its own payload.
There is no sibling dependency or third legacy distribution. The former Codex
payload path is migrated atomically with its Marketplace pointer; Plugin and
Marketplace identities remain `debugging-cdp-targets`. Root `LICENSE`, shared
Skill, runtime helpers/notices and all unchanged official release bytes must match
in both outputs. Maintained `plugin-README.md` maps to each installed `README.md`;
the source directory's `README.md` retains contributor ownership.

Pure host descriptors centralize paths without reading files or release evidence.
This preserves standalone lockfile preflight before dependency installation.
Builds verify existing official release evidence and both locks before assembly.
Each output has independent exact inventory, format, Marketplace, version,
license and original-package checks; generated comparisons never repair drift.
Security fingerprints cover both official copies and both Marketplace catalogs.

Host adaptation stays in packaging and documentation. The seven MCP lifecycle
tools, official arguments/results, `_dct` connection/session routing and identity
checks retain ADR 0011's contract. Hooks retain four events, three-second timeouts,
JSON text context and one-time Stop continuation. Codex definition trust and Claude
enabled/disabled Plugin Hooks are tested according to each host's actual controls.
Actual Marketplace discovery and model context are tested with temporary homes,
loopback models and the production gateway's I/O fixture; real host smokes remain
opt-in. Claude Code 2.1.283 is the first accepted baseline.

This extends the distribution and host assumptions of ADRs 0005 and 0009–0011.
Their runtime, immutable official release, connection isolation and normal-close
decisions remain. No dependency upgrade, publication, persistent session or user
configuration migration accompanies this change.
