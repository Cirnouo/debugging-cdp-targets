# Interface implementation

Keep MCP stdout reserved for the official SDK stdio transport. Diagnostics use
stderr. Control outputs one JSON result. Accept status/start/restart/stop/end-task
with mandatory entry identity. Restart/end-task/stop require current session
identity; status/start prohibit it. Only stop accepts disposition. End-task
clears the active watch while retaining the target and upstream.
Reject ambiguous, duplicate, missing, unknown, or inapplicable options. Parse
commands into argv, never a shell command. There is no switch action.
The gateway forwards official tools without rewriting their schemas or results;
only lifecycle status and watch tools belong to this Plugin.
