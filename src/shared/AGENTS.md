# Shared implementation

Keep this layer dependency-free and free of I/O. Add a constant here only when
it is a cross-layer invariant. Domain behavior and platform details stay in
their owning modules. Do not introduce generic utils/helpers modules.
