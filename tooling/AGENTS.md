# Tooling implementation rules

Develop validator behavior test-first with adversarial snapshots or executable
fixtures. Every rule must inspect independently derived evidence; a validator
must not treat its own source, the payload being copied, or a deduplicated parser
result as proof that the input is safe.

Keep tooling non-destructive and cross-platform unless a check explicitly runs
only in the Windows CI job. Centralize commit types, scopes, branches, payload
paths, and other shared grammar in one owned module, then consume that source
from hooks, CI, and audits. Parse structured formats with their real parser and
validate value types and paths, rather than approximating YAML or JSON with
regular expressions.

Repository and distribution audits must fail closed on malformed, ignored, or
unexpected payload content. Do not execute payload code during static audits,
do not download dependencies in tests, and do not mutate Git history, user
state, browser profiles, or globally installed Skills.
