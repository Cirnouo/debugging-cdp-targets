# Desktop content boundaries

This delivered slice contains configuration only. Parent instructions remain
cumulative. Main, preload, renderer, singleton/activation and selected data-root
owners stay in their current interface/adapters locations; this directory grants
no future GUI, native, administrative or application-lifecycle capability.

Before editing configuration schemas, migration, persistence or consumers, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md), the
[accepted singleton plan](../../.superpowers/plans/2026-10-17-singleton-app-plan.md)
and the cumulative [configuration instructions](configuration/AGENTS.md).
Only exact configuration/store.ts owns its reviewed filesystem transaction.
The model and unreviewed desktop siblings acquire no store, adapter, Node I/O,
ambient process, clock or network capability from this parent directory.
