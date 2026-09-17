# ADR 0004: Use explicit target adapters

- Status: Accepted
- Date: 2026-09-17

## Context

Google Chrome can be identified and launched with a dedicated profile, while
other Chromium/Electron applications have application-specific behavior. Tauri
is a framework whose programs may use WebView2 or other renderer arrangements;
ordinary Chromium switches are not a universal contract.

## Decision

Expose `chrome` and `generic-cdp` adapters. `chrome` requires Google Chrome file
and endpoint identity and owns the dedicated profile. `generic-cdp` provides
best-effort launch and renderer inspection only when the target honors the
runner's loopback CDP switches and compatible endpoint contract. Extension mode
is Chrome-only behind capability gates. No adapter enables PWA category mode.

Treat full Chrome DevTools MCP configuration and a dedicated Tauri/WebView2
adapter as future extension points, not implemented behavior.

## Consequences

Callers make compatibility explicit and cannot silently weaken Chrome identity
checks. Obsidian uses `generic-cdp` with target-specific guidance. Unsupported
Tauri/WebView2 hosts fail rather than being advertised as compatible.
