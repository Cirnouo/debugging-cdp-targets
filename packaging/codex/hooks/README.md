# Target exit Hooks

`hooks.json` calls the existing `cdp-targets/dct_connection_status` MCP tool at
PreToolUse, PostToolUse, UserPromptSubmit and Stop. Handlers only drain recorded
in-memory process exit events. They never scan processes or start a service.
No pending event returns `{}` and adds no model context. Delivery is once per
connection/session; Stop returns one continuation only for an undelivered exit.

Enable Codex Hooks and review the current plugin Hook definitions through the
standard Codex trust flow. Installing or enabling the plugin does not grant
Hook trust. Changed definitions require review again. See the official
[Codex Hooks documentation](https://learn.chatgpt.com/docs/hooks).
