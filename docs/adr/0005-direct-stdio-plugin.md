# 0005 — Direct official MCP in a Codex Plugin

Status: partially superseded by ADR 0007 for stdio ownership and gateway topology,
ADR 0008 for per-target connections, and ADR 0009 for Hook packaging.
Supersedes the distribution, daemon, persisted-state, and application-specific
parts of ADRs 0001–0004.

## Context

The intended experience is direct official MCP tools, with extra control over
launching a CDP application and switching targets. A CLI daemon wrapper and
cross-session JSON add an unnecessary separate tool interface.

## Decision

Ship a portable Codex Plugin and repository local Marketplace. A Node bootstrap
opens stable loopback CDP HTTP/WebSocket and temporary local control IPC, then
starts the pinned public official Server bin with inherited stdio. It does not
parse MCP messages. Separate control commands operate one in-memory target.
The control slot is per OS user: only one active Plugin MCP connection is
supported in 0.1.0. Refuse another connection rather than silently controlling
another conversation's application. Connection IDs and parallel contexts are
future work, not an implicit multi-session feature.

Source uses interface/application/domain/adapter/shared ownership. Bundle ws
with esbuild; distribute the MIT notice. Windows process evidence uses a thin
PowerShell helper; Unix uses ps/lsof. Chrome has recommended launch defaults;
all other targets are generic known-CDP launch templates, not app recipes.

## Consequences

Switching closes CDP sockets and requires fresh page discovery. Upstream
reconnection must be tested against the pinned version. Transient control is
not Resume state; forced bootstrap termination may leave a target for manual
cleanup. Generic framework compatibility is not promised. GitHub installation
cannot be validated against unpushed changes.
