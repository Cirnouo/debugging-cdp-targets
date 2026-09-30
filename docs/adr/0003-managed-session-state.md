# ADR 0003: Manage one session in fixed LOCALAPPDATA state

- Status: Superseded by ADR 0005; no persisted session state
- Date: 2026-09-17

## Context

Safe resume and cleanup require stable identity independent of the caller's
working directory. Concurrent operations and multiple ambiguous targets would
weaken ownership guarantees.

## Decision

Manage one target/daemon relationship per Windows user. Store its approved
identity at `%LOCALAPPDATA%\debugging-cdp-targets\state\session.json`, serialize
mutations with a per-user named-pipe lock, and keep the CLI runtime/cache in a
separate LOCALAPPDATA subtree. Keep is represented as a detached session with a
stopped daemon; Resume revalidates the target before restarting only the daemon.

## Consequences

Status and Resume work from any directory, and cache cleanup cannot silently
erase lifecycle ownership. A second Start must finish or recover the recorded
session first. Invalid or mismatched state fails closed instead of being replaced.
