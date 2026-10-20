# Official supplied rules, package-file proof and launch inputs

Apply root, [source](../../AGENTS.md) and [Gateway](../AGENTS.md) instructions
cumulatively. The options, execution and release-evidence owners operate only on
supplied values/events with
relative Gateway/domain/shared dependencies. No environment/process/clock, Node,
filesystem, network, native or external-package I/O is permitted, including
through erased imports, reexports, import() or require. Unknown siblings stay pure.

options.ts owns reviewed flags, aliases, safe option parsing, complete recipes and
buildOfficialServerArguments with four explicit inputs. Pass the original supplied
environment object: no copy, normalization or default reads. Preserve URL refusal,
selected Windows/POSIX getter semantics, boolean-validation-before-option ordering,
PWA refusal and original token/output order. The effectful buildOfficialLaunchArguments
entry in server-launch.ts owns actual invocation-time defaults;
its child environment snapshot remains a separate later boundary.

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

package-files.ts alone owns verifyOfficialPackageFiles and the complete canonical
root, containment, inventory, link/nonregular, descriptor-pinned byte, digest and
manifest transaction. Its five exact direct dependencies are node:crypto,
node:fs/promises, node:path, ./release-evidence.ts and
../../adapters/file-evidence.ts. Keep original bytes and explicit pnpmInstalled
build-input-only shim treatment; runtime/delivery permit no shim exception. The
shared regular-file reader remains in its adapter for fingerprint consumers.
This role grants no ambient environment/process/clock/network or live-child
authority. Pure siblings and unknown Gateway owners cannot depend on it, including
erased imports/reexports/import()/require; actual adapters and only the exact
server-launch.ts Gateway owner consume it directly.

server-launch.ts owns the complete captureOfficialServerEnvironment,
buildOfficialLaunchArguments and resolveVerifiedOfficialServerBin functions. Its
five exact direct dependencies are node:path, ./options.ts, ./release-evidence.ts,
./package-files.ts and ../../shared/errors.ts. Only environment=process.env at
parameter0 of captureOfficialServerEnvironment or parameter1 of
buildOfficialLaunchArguments, and windowsEnvironment=process.platform==='win32'
at parameter3 of the latter, may read ambient state. Preserve invocation timing,
original supplied-object getter/spread semantics and separate later child capture.
No top-level/body/alias/computed reads, clock, network, SDK, native or child-process
authority is granted. Pure/unknown owners, registry, connections and package-files
cannot acquire this owner through any value or erased dependency form. Core's
closed role and actual adapters consume it; complete child/catalog/wire/disposal
transactions remain in their existing adapters.

Before changing a consumer of target launch/isolation contracts, read the
[target model instructions](../targets/model/AGENTS.md) and
[ADR 0015](../../../docs/adr/0015-explicit-data-directory-isolation.md). Preserve
explicit intent, validation before acquisition, immutable snapshots and leases.
Before changing complete package-file proof or moving ambient launch defaults,
live child/catalog or MCP continuation responsibility here, read the canonical
[application lifecycle instructions](../../application/AGENTS.md),
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md),
[ADR 0018](../../../docs/adr/0018-mcp-protocol-compatibility.md),
[organization policy](../../../docs/policies/repository-organization.md) and
[instruction disclosure policy](../../../docs/policies/documentation.md#instruction-progressive-disclosure),
and review cumulative roles with the runtime-source auditor. Pure ownership grants
none of those additional capabilities; the exact package-file role grants no
permission to split a transaction or widen its five dependencies. The exact launch
role likewise grants only its named defaults and five dependencies.
