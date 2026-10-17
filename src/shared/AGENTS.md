# Shared implementation

Before changing this layer's singleton App architecture, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md). The direct HTTP App owns
all resources; thin host plugins contain metadata, artwork and the shared Skill.

Keep this layer dependency-free and free of I/O. Add a constant here only when
it is a cross-layer invariant. Domain behavior and platform details stay in
their owning modules. Do not introduce generic utils/helpers modules.
