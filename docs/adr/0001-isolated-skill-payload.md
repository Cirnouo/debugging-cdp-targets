# ADR 0001: Isolate the installable Skill payload

- Status: Superseded by ADR 0005 for distribution
- Date: 2026-09-17

## Context

Repository policies, tests, and development tooling are not required when an
agent installs and runs the Skill. A root-level Skill would also compete with a
nested payload during discovery.

## Decision

The complete distribution lives at `skills/debugging-cdp-targets/`. It contains
one `SKILL.md`, agent metadata, target references, runtime scripts, payload
documentation, local implementation instructions, and an MIT license. The
repository root contains no discoverable `SKILL.md`.

## Consequences

Skills CLI discovery yields exactly one Skill, and distribution checks can audit
one explicit subtree. Repository-only tests, policies, hooks, and tooling remain
outside the installed payload. Payload directories retain README and local
AGENTS files because they are intentional operational context.
