# CDP and lifecycle security

The Plugin permits one active MCP connection per OS user and one current target
in that connection's memory. It creates
no persistent session record, Resume workflow, or CLI daemon. An isolated
package cache is not a session and cannot authorize attaching to a process.

Validate executable path, launch creation time, user/session, process tree,
loopback listener ownership, and browser-level WebSocket endpoint. Never
connect to an unverified or pre-existing target. Skip occupied, privileged, and
OS-excluded ports; distinguish a probe race from a failed application launch.

The official Server directly inherits MCP stdin/stdout. Bootstrap diagnostics
go to stderr only. The CDP router forwards CDP, not MCP, and disconnects old
WebSockets on switch. Do not log commands, page data, cookies, network/console
data, secrets, or tool calls.

Require an explicit user Close/Keep choice. Close requests normal shutdown;
failure reports PID/port and never escalates. Keep leaves local CDP reachable.
Unexpected handled disconnect attempts normal close; force termination cannot
guarantee it. Preserve old experimental state and global installations unless
the user separately authorizes cleanup.

Server defaults enable extensions and disable usage statistics and CrUX.
Only compatible Chrome may use extension tools. Explicit environment overrides
require a new MCP connection. Do not permit arbitrary Server arguments to
override connection identity or inject a shell.

Dependency installation and build-time audit requirements are specified in
[supply-chain.md](supply-chain.md). They do not authorize changing the runtime
package acquisition design or claim that future downloads are risk-free.
