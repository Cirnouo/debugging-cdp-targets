# 0011 — Native MCP lifecycle and fixed official capabilities

Status: accepted for unreleased 0.1.0.
Partially superseded by [0013](0013-session-owned-exit-cleanup.md) for resource
ownership, actual-exit cleanup, live restart, child disposal, status projection
and Hook acknowledgement. The text below records the original decision.

The CLI/control IPC split made Agents responsible for launching wrappers, while
Codex cached the initial tool catalog and ignored later local list changes.
The approved architecture removes the plugin CLI and dedicated control IPC.
Codex starts one independent stdio gateway per chat; each new verified target
gets its own controller, router and unchanged official MCP Server.

Seven MCP tools expose status/start/restart/stop/end-task/wait/cancel. Mutations
are asynchronous and idempotent by request identity and canonical request hash.
Connection/session checks reject stale work. Bounded replayable memory events
and fixed bounded waits avoid polling guesses. Cancelling a wait is independent
of cancelling an operation. Trusted Hooks deliver new results at task boundaries;
idle chats are not woken. There is no persisted session or fixed connection limit.

Application launch uses executable/args/cwd/env, with no launchCommand or mcp-cwd.
Windows built-in support inspects manifests/compatibility and native errors,
preserves custom environment across elevation, and retains real app PID, creation
time and an observation handle. A maintained fixed native helper may broker a
one-shot elevated launch/normal close through an authenticated private pipe.
It is not the target. Permission waiting precedes the CDP readiness budget.
Cancellation races close created targets normally or report retained identity.

Every connection accepts reviewed official mcpArgs while gateway-owned endpoints,
browser creation, config-file and CLI options are reserved. The fixed full catalog
is generated and verified from the pinned public bin's configuration matrix:
66 names across 53 profiles for 1.10.1. Same-name schema variants have a compatible
declaration; status provides the actual upstream schema. Actual enabled tools
come from each tools/list. Disabled tools return TOOL_NOT_ENABLED with conditions
and a complete explicit start/restart recipe. No silent enable/restart occurs.
Slim changes actual tools, not Codex's initial full catalog. PWA tools require
the official pipe-launched browser and are explicitly unsupported in this design.

Official arguments/results are forwarded unchanged after removing only _dct.
Workspace roots forwarding remains negotiated; official --workspace is explicit
directory authorization. cwd never grants file access.

Timeout or client cancellation can leave official handlers holding their mutex
because they do not consume cancellation. Quarantine gates only that connection,
disconnects pending HTTP/CDP traffic and normally closes the official transport.
It preserves app identity for explicit recovery, without replay or dependency
patching. Diagnostics contain bounded phase/outcome/elapsed and session metadata.
An absent listener permits verified app close; a foreign listener is distinct.

This supersedes CLI/control IPC and status-only catalog rules in 0005, 0007 and
0008, and extends 0009 with operation/quarantine events. 0010's immutable complete
official release, supply-chain evidence, licenses and public-bin requirements remain.
No dependency upgrade, installed-plugin/global config or historical-state migration
is part of this change. Version 0.1.0 remains unreleased.
