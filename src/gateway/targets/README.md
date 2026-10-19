# Gateway target models

- `model/` owns pure endpoint identity validation and supplied target/resource
    contracts, profile argument and screenshot composition, isolation intent and
    structured launch values; its local map describes the six delivered owners.
- `AGENTS.md` keeps this slice limited to those models and preserves the current
    acquisition, reservation, observation and cleanup owners.

The existing adapters acquire and verify actual targets; application owners hold
connection and cleanup state. Domain `cdp-target.ts` still contains PortRange
and the standalone candidate chooser. This slice does not complete target or
port-lifetime reorganization.
