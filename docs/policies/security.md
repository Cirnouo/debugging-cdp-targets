# CDP and lifecycle security

Each reusable entry manages one newly launched target. Entry UUID, session UUID,
control pipe, target, CDP port, and upstream child are independent. No persistent
session record, CLI daemon, or process takeover is permitted. An isolated
package cache cannot authorize attaching to a process.

Validate executable path, launch creation time, user/session, process tree,
loopback listener ownership, and browser-level WebSocket endpoint. Skip occupied,
privileged, and OS-excluded ports on new launches. Recovery must use the original
port and refuse clearly when it is occupied; never silently choose another port.

The official SDK gateway owns host stdio and preserves the official Server's tool
catalog and results. Only dct_connection_status and dct_watch_target are additional
lifecycle tools. Diagnostics go to stderr. Do not log commands, page contents,
cookies, network/console data, secrets, or tool calls.

Require explicit Close/Keep before changing entries or ending work. Keep retains
both application and upstream child. Close requests normal shutdown of both and
keeps the host transport reusable. Failure reports PID/port without force kill.
Handled host disconnect attempts normal close; force termination cannot guarantee
cleanup. Preserve old experimental state and global installations.

Detect manual target loss through events or at least two failed polling checks.
While a task is active, request standard MCP form elicitation within five seconds:
recover an accidental close on the same port, or terminate dependent work after
an intentional close. Idle entries ask only on next use. Never automatically
restart or replay tools. Retain launch argv, cwd, and profile in memory exactly;
recovery invalidates every page ID and requires fresh list_pages evidence.

Server defaults enable extensions and disable usage statistics and CrUX. Only
compatible Chrome may use extension tools. Environment overrides require a new
connection. Do not permit arbitrary upstream arguments to alter identity or
inject a shell. See [supply-chain.md](supply-chain.md) for dependency requirements.
