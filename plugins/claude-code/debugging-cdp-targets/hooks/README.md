# Claude Code automatic Hooks

`hooks.json` registers PreToolUse, PostToolUse, UserPromptSubmit and Stop. Each
uses the fully qualified `plugin:debugging-cdp-targets:cdp-targets` MCP server
to call `dct_connection_status` with the event name and a three-second timeout.
Enabling the Plugin loads these default Hooks unless `disableAllHooks` is true.
