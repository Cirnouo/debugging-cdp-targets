# Domain implementation

Do not import Node I/O, adapters, application, or environment globals. Inputs
carry evidence and environment mappings; output rules are deterministic.
Preserve structured argument boundaries, reject unresolved variables and conflicting
known port sources, and support generic caller-provided port placeholders.
Identity must fail closed, not guess a different framework contract.

For the accepted [isolation design](../../docs/adr/0015-explicit-data-directory-isolation.md),
validate the required none/data-dir union and existing/new operations without I/O.
Require absolute selections, preserve operation choice and explicit cleanup policy,
and accept directory evidence as input. Bind {dataDir} only in args/env as opaque
path bytes after ordinary expansion; never re-expand inserted path text. None
rejects the placeholder. Do not encode a location denylist or infer application
isolation support from a framework name.
