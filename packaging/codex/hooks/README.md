# Target exit Hooks

`hooks.json` calls the existing `cdp-targets/dct_connection_status` MCP tool at
PreToolUse, PostToolUse, UserPromptSubmit and Stop. Handlers only drain recorded
in-memory exit, operation and connection events. They never scan processes or
start a service.
No pending event returns `{}` and adds no model context. Delivery is once per
connection/session or operation; Stop returns one continuation only for an
undelivered event. Terminal results already delivered through status/wait,
terminal cancel or identical mutation retry are acknowledged and not repeated.
Aborted requests and nonterminal responses leave notices unread. Expected exits
are grouped by operation ID with every related exit and cleanup result, including
new Target rollback during restart; pending cleanup delays consumption/delivery.
Hooks emit compact independent events and
never full results, errors, configuration, diagnostics, schemas or recipes.

Enable Codex Hooks and review the current plugin Hook definitions through the
standard Codex trust flow. Installing or enabling the plugin does not grant
Hook trust. Changed definitions require review again. See the official
[Codex Hooks documentation](https://learn.chatgpt.com/docs/hooks).
