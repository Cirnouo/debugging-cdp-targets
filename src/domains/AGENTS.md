# Domain implementation

Do not import Node I/O, adapters, application, or environment globals. Inputs
carry evidence and environment mappings; output rules are deterministic.
Preserve quoted argument boundaries, reject unresolved variables and conflicting
known port sources, and support generic caller-provided port placeholders.
Identity must fail closed, not guess a different framework contract.
