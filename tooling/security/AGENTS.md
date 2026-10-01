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
a newly created temporary directory, disable every lifecycle script and pnpmfile
hook, prevent configuration-dependency loading, isolate
its store/configuration, and remove only that created directory. Never execute
the downloaded Server, consult runtime caches, or launch a browser. Tests replace
the process boundary and must not download dependencies.

Lockfile-phase checks must run without reading installed metadata or resolving
the upstream project. Validate manifest agreement and effective configuration,
reject unreviewed configuration dependencies before invoking pnpm,
then frozen lock-only validation and full registry audits. Lock-only commands
must not mutate locked inputs or create node_modules. In upstream isolation,
resolve only the lock first, approve findings with current evidence, and only
then perform a frozen script-disabled install; preserve the approved inputs.

Build the standalone entry with the existing esbuild/YAML dependencies and
preserve the parser license. Keep generated code out of manual formatting, but
verify it byte-for-byte against maintained source. All maintained policy code
remains tested; audit artifacts never belong to the Plugin payload.

Keep this network gate separate from default tests and verify:push. Never repair
a trust failure by automatically adding exceptions, changing registry, reducing
cooldown, or trusting the lockfile. Report and stop the affected check.
