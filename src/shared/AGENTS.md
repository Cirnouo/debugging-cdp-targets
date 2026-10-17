# Shared implementation

Before implementing this layer’s singleton App migration, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md) and the
[tracked plan](../../docs/superpowers/plans/2026-10-17-singleton-app-plan.md).
These are forward requirements; current stdio rules apply until their planned cutover.

Keep this layer dependency-free and free of I/O. Add a constant here only when
it is a cross-layer invariant. Domain behavior and platform details stay in
their owning modules. Do not introduce generic utils/helpers modules.
