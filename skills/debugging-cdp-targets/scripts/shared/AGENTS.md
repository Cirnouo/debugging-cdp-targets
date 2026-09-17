# Shared rules

Keep shared code independent of interface, application, domains, and adapters.
Use constants.mjs for invariants shared across modules. Helpers must not read
user state or invoke target/daemon behavior. Domain callers may only use pure
value helpers; application and adapters own timer/server lifecycle effects.
