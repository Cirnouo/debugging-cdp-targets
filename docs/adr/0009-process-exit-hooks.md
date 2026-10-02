# Process exit events and automatic Codex Hooks

Status: accepted. Supersedes monitoring and default-profile choices in 0007
and 0008; keeps their connection isolation, routing and explicit recovery rules.

## Context

Agent-issued watch leases added repeated tool calls and left task lifetime
dependent on renewal. A kept target's later exit also left its upstream alive.
Ordinary MCP logging cannot place an unsolicited message in model context.
Users need the same dedicated Chrome profile across starts and recovery.

## Decision

Observe each launched child through its native exit event and retained
exitCode/signalCode from startup. Subscribe once with revocable listeners and
check current connection/session before applying events. Do not periodically
scan running targets. Keep bounded startup readiness checks and identity
verification before official tool calls.

Maintain task activity independently: start/restart and official use activate
work; Keep/end-task end it. An unexpected exit during work gates tools, retains
launch identity and queues one reminder. Codex MCP Tool Hooks call the existing
status tool to drain reminders at PreToolUse, PostToolUse, UserPromptSubmit and
Stop. The first three add model context; Stop blocks once with a reason if an
event remains. No event returns empty JSON. Idle conversations wait for their
next turn. No additional worker, daemon, persisted session, or automatic replay
is introduced. The former watch tool, leases and recovery forms are retired.

Ended tasks keep live targets and upstreams. Their later exit closes only their
upstream/router and removes their connection. Failed cleanup retains retry
identity and reports the actual failure. Expected shutdown events are silent;
CDP/upstream failure with a live process is a connection error, not process exit.

Use the fixed user-home `.cache/chrome-devtools-mcp/chrome-profile` by default.
Explicit directories win. Check native Chrome ownership before launch and
reserve canonical directories across launches within the gateway. Fail closed
on occupied or unverifiable ownership; require an explicit alternative. Release
reservations on actual exit or confirmed normal close. Recovery preserves the
original directory, argv, cwd and port. Other directories permit concurrency.

Codex 0.160.0's Agent Plugins loader explicitly skips bundled Hooks. Use
`.codex-plugin/plugin.json` with explicit MCP and Hook paths so Codex discovers
both. Keep the existing MCP schema and marketplace identity. MCP startup uses
plugin-root-relative `cwd: "."` and `dist/mcp-bootstrap.mjs` argv because the
[native MCP loader](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/codex-mcp/src/plugin_config.rs)
does not expand the Agent Plugins `${PLUGIN_ROOT}` variable. Hook execution
requires the standard user review of the exact definition; installation never
implicitly trusts it. See [Hooks](https://learn.chatgpt.com/docs/hooks) and the
[installed-version loader](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core-plugins/src/loader.rs).

## Evidence and consequences

Regressions use fake process/CDP/upstream I/O. An opt-in isolated Codex app-server
test installs the actual manifest/Hook files in a temporary home, uses the real
gateway and a local model substitute, and checks outbound model requests for
the reminder. It covers untrusted Hooks, tool boundaries, Stop continuation and
idle delivery, with no Agent watch call or real browser. Hook trust remains a
user setup step. Version 0.1.0 remains unreleased.
