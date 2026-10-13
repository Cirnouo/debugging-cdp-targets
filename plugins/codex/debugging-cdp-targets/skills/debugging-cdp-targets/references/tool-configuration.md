# Tool configuration

On TOOL_NOT_ENABLED or a requested unavailable tool, and before changing tool
enablement/workspace access or inspecting configuration sources/diagnostics, read
this reference. Use the
[main workflow](../SKILL.md#tool-availability-and-routing) for exact-schema discovery
and routing, and the question contract/current locale before a needed question.

Request selected
`include: ["configuration"]` for mcpArgs/workspace sources or
`include: ["diagnostics"]` for bounded diagnostics; includes can combine with
toolNames. Do not request configuration, schemas or diagnostics unless needed.

For example, click_at needs experimentalVision=true with its other conditions.
Supported explicitly disabled tools and TOOL_NOT_ENABLED include missing
conditions and complete replacement suggestedMcpArgs. Enabled tools have no
activation recipe; unsupported tools provide a reason without a recipe.
Use those only in an explicitly authorized start/restart; the gateway never
silently enables tools. Slim connections retain their actual slim tool names;
the global catalog remains full. Working directory does not grant file access:
use official `--workspace` directories and explicitly include status configuration
when inspecting workspace sources.

For an unresolved tool-enablement authorization, use `tools-start` before launch
or `tools-restart` for a verified live connection. Display the complete proposed
`mcpArgs` replacement, including workspace access; a request to inspect a page
does not itself authorize unrelated filesystem grants. Unsupported tools only
receive their established reason, never an invented enablement question.
