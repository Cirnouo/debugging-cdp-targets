# Interface implementation

Keep MCP stdout reserved for the official SDK stdio transport. Diagnostics use
stderr. Lifecycle requests use MCP tools and structured output. Except initial
empty status discovery, require entry identity. Status optionally selects a connection; start
allocates one. Restart/end-task/stop require connection and current session
identity; status/start prohibit session identity. Only stop accepts disposition. End-task
ends task activity while retaining a live target and upstream; exited targets retire.
Reject missing, unknown, or inapplicable fields. Launch receives structured
executable/args/cwd/env and separate mcpArgs; never a shell command.
Mutations return an idempotent operation immediately; wait replays bounded events,
and explicit operation cancellation owns cleanup. Wait cancellation is independent.
The gateway adds required _dct connection/session routing to official input
schemas, rejects collisions, and strips it before forwarding original arguments.
Results are unchanged; lifecycle/operation tools belong to this Plugin. Optional
hookEventName accepts exactly the four packaged host events; empty status is read-only.
