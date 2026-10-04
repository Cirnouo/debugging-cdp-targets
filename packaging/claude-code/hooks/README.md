# Claude Code automatic Hooks

`hooks.json` registers PreToolUse, PostToolUse, UserPromptSubmit and Stop. Each
uses the fully qualified `plugin:debugging-cdp-targets:cdp-targets` MCP server
to call `dct_connection_status` with the event name and a three-second timeout.
Enabling the Plugin loads these default Hooks unless `disableAllHooks` is true.
They drain compact in-memory exit, operation and connection events. No pending
event returns {}. Successful terminal status/wait, terminal cancel or identical
mutation retry delivery acknowledges its operation notice; aborted requests and
nonterminal responses leave it unread. Expected exits are grouped by operation
ID with every related exit/cleanup fact, including new Target rollback; pending
cleanup retains both the exit facts and notice until all results are ready.
Hooks never
embed full results, errors, configuration, diagnostics, schemas or recipes.
