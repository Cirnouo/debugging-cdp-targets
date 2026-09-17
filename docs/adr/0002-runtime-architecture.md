# ADR 0002: Use one Node entry with domain modules

- Status: Accepted
- Date: 2026-09-17

## Context

The workflow needs portable orchestration and narrow Windows APIs for process,
listener, executable identity, and normal-window-close inspection. Multiple
public scripts would allow callers to bypass lifecycle checks.

## Decision

Node.js owns the public workflow, parsing, policy, state, target launch, daemon
control, and transactions. `scripts/cdp-session.mjs` is the only public entry.
The PowerShell helper is a thin internal Windows adapter and never launches or
force-kills targets. Source is separated into interface, application, domain,
adapter, and shared modules with inward dependency boundaries.

## Consequences

Every public action passes through one validation path. Windows-specific code is
small and replaceable, while domain policy remains testable without real user
targets. Internal helpers are not a supported compatibility surface.
