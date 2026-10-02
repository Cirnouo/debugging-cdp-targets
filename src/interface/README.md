# Composition interfaces

- `mcp-bootstrap.ts` starts the reusable gateway, which owns host MCP stdio
  through the official SDK.
- `control.ts` executes one management command and prints structured JSON.
- `control-arguments.ts` validates management CLI grammar.
- `AGENTS.md` defines public entry and output contracts.
