# Interface implementation

Keep MCP stdout reserved for the official SDK stdio transport. Diagnostics use
stderr. Control outputs one JSON result. Accept status/start/restart/stop/end-task
with mandatory entry identity. Status optionally selects a connection; start
allocates one. Restart/end-task/stop require connection and current session
identity; status/start prohibit session identity. Only stop accepts disposition. End-task
clears the active watch while retaining the target and upstream.
Reject ambiguous, duplicate, missing, unknown, or inapplicable options. Parse
commands into argv, never a shell command. There is no switch action.
The gateway adds required _dct connection/session routing to official input
schemas, rejects collisions, and strips it before forwarding original arguments.
Results are unchanged; only lifecycle status and watch tools belong to this Plugin.
