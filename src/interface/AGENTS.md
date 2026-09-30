# Interface implementation

Keep MCP bootstrap stdout completely untouched. Control outputs one JSON result.
Accept only status/start/switch/stop. Reject ambiguous, missing, unknown, or
inapplicable options. Parse commands into argv, never into a shell command.
No browser inspection or custom MCP method dispatch belongs here.
