# Supply-chain implementation rules

Observe failing adversarial tests before changing policy. Parse all pnpm YAML
documents, including package-manager dependencies; derive expected identities
and counts from the lock graph, never from the audit's own totals. Check the
installed runtime graph and included development/optional groups independently.
Reject non-registry resolution identities, missing integrity, incomplete graphs,
filtered reports, unknown severities, malformed JSON, and network errors.

High/critical findings block by default. Only an exact, unexpired reviewed
GHSA/package/version/scope exception with unchanged code, configuration, and
graph SHA-256 evidence can waive a vulnerability. Exceptions cannot authorize
signature, installation trust, or command failures. Evidence must be a maintained
repository file. Do not infer non-exploitability merely from absent calls.

Run pnpm with argv and shell disabled, hide child windows, bound process time and
output, and propagate failures. Isolate the configured official MCP version in
a newly created temporary directory, disable every lifecycle script, isolate
its store/configuration, and remove only that created directory. Never execute
the downloaded Server, consult runtime caches, or launch a browser. Tests replace
the process boundary and must not download dependencies.

Keep this network gate separate from default tests and verify:push. Never repair
a trust failure by automatically adding exceptions, changing registry, reducing
cooldown, or trusting the lockfile. Report and stop the affected check.
