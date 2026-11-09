# Supplied elapsed presentation

Root, source and Desktop instructions apply cumulatively. Before changing the
formatter or its manager consumer, read [ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md)
and the [accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md).

Only elapsed.ts is delivered here. formatAppElapsed takes supplied timestamp/now
values; retain finite/nonnegative validation, unavailable evidence, future clamp,
floor arithmetic and unbounded hours. It has no imports, Date/performance clock,
interval, React or renderer state. Only current interface/app-manager.ts consumes
it. Unknown siblings remain pure and dependencyless, without store, Node,
Electron/React/SDK, native, process or network capability.

Polling, clock reads, mounted/pending/error/selection/detail state and effect
cleanup stay one current manager session; settings retains its existing draft.
Do not create a state mirror, facade, new effect or restyle as part of this owner.
