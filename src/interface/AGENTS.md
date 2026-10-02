# Interface implementation

Keep MCP stdout reserved for the official SDK stdio transport. Diagnostics use
stderr. Control outputs one JSON result. Accept status/start/restart/stop/end-task
with mandatory entry identity. Status optionally selects a connection; start
allocates one. Restart/end-task/stop require connection and current session
identity; status/start prohibit session identity. Only stop accepts disposition. End-task
ends task activity while retaining a live target and upstream; exited targets retire.
Reject ambiguous, duplicate, missing, unknown, or inapplicable options. Parse
commands into argv, never a shell command.
The gateway adds required _dct connection/session routing to official input
schemas, rejects collisions, and strips it before forwarding original arguments.
Results are unchanged; only lifecycle status belongs to this Plugin. Optional
hookEventName accepts exactly the four packaged Codex events; empty status is read-only.
