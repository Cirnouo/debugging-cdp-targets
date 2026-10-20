# Pure Official options, execution values and release evidence

Apply root, [source](../../AGENTS.md) and [Gateway](../AGENTS.md) instructions
cumulatively. These three owners operate only on supplied values/events with
relative Gateway/domain/shared dependencies. No environment/process/clock, Node,
filesystem, network, native or external-package I/O is permitted, including
through erased imports, reexports, import() or require. Unknown siblings stay pure.

options.ts owns reviewed flags, aliases, safe option parsing, complete recipes and
buildOfficialServerArguments with four explicit inputs. Pass the original supplied
environment object: no copy, normalization or default reads. Preserve URL refusal,
selected Windows/POSIX getter semantics, boolean-validation-before-option ordering,
PWA refusal and original token/output order. The effectful buildServerArguments
entry in adapters/official-server.ts still owns actual invocation-time defaults;
its child environment snapshot is a separate later boundary.

execution.ts owns only one supplied wire id and once-only terminal latch. Preserve
exact id type, single assignment, response/result-error XOR, close idempotence and
no result archive. Actual slot accounting, originating facilities, wire transport,
child exit and disposal stay with their current Core/bridge transaction owners.
Client cancellation detaches a response, never proves execution/child completion.

release-evidence.ts validates unknown original-release and manifest evidence through
shared constants/errors/payload-path. Preserve complete fields, provenance, sorted
case-distinct inventory, digests, sizes, required files/Skills and optional peers.
Portable syntax alone proves neither containment nor Official provenance. Never
read packages, refresh evidence, acquire a release or import a private upstream CLI.

Before changing a consumer of target launch/isolation contracts, read the
[target model instructions](../targets/model/AGENTS.md) and
[ADR 0015](../../../docs/adr/0015-explicit-data-directory-isolation.md). Preserve
explicit intent, validation before acquisition, immutable snapshots and leases.
Before moving ambient launch defaults, package-file verification, live child/catalog
or MCP continuation responsibility here, read the canonical
[application lifecycle instructions](../../application/AGENTS.md),
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md),
[ADR 0018](../../../docs/adr/0018-mcp-protocol-compatibility.md),
[organization policy](../../../docs/policies/repository-organization.md) and
[instruction disclosure policy](../../../docs/policies/documentation.md#instruction-progressive-disclosure),
and review cumulative roles with the runtime-source auditor. Current pure ownership
grants none of those additional capabilities or permission to split a transaction.
