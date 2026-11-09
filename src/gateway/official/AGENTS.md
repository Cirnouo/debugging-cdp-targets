# Official supplied rules, package-file proof, launch inputs and upstream lifetime

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
child exit and disposal stay with the managed connection and upstream transaction owners.
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
authority is granted. Managed connection, start admission and connection view
consume it through their exact ../official/server-launch.ts edges. Upstream uses
./server-launch.ts, and actual adapters also consume it. Core, registry, pure or
unknown owners, package-files and other connection roles cannot acquire it through
any value or erased dependency form.

upstream.ts owns the complete openOfficialUpstream transaction. Keep the private
catalog publisher, admitted Tool, SDK transport and wire latch, original roots
and form callbacks, synchronous child enrollment, actual exit and bounded reaping
together. The fixed outward catalog, managed connection's execution slot and
original client facilities, and HTTP continuation stay with their existing owners.
Preserve serialized uncapped refresh, atomic live-owner publication and unavailable
recovery. Closing the upstream fences publication and closes the logical transport
before confirming actual child exit.

The upstream uses only these exact named dependency bindings:

- node:child_process supplies spawn.
- @modelcontextprotocol/client supplies Client, ProtocolError, ProtocolErrorCode,
    ReadBuffer, SdkError, SdkErrorCode and serializeMessage. CallToolResult,
    ElicitRequestFormParams, ElicitResult, JSONRPCMessage, ListRootsResult,
    Progress, Tool and Transport are TYPE-only.
- @modelcontextprotocol/core supplies CallToolResultSchema and ListToolsResultSchema.
- ../../domains/control-contract.ts supplies only Diagnose TYPE.
- ../../domains/request-failure.ts supplies RequestFailure.
- ../diagnostics.ts supplies measured.
- ./execution.ts supplies createOfficialExecution.
- ./server-launch.ts supplies buildOfficialLaunchArguments,
    captureOfficialServerEnvironment and resolveVerifiedOfficialServerBin.
- ../../shared/constants.ts supplies CLOSE_TIMEOUT_SECONDS.

Only the verified spawn executable fallback reads process.execPath. Only the
original five direct zero-argument performance.now() calls in reapOwnedChild's
deadline and remaining-time expressions read the clock. Preserve the direct
public-bin fallback, unaliased owned child, shell:false and the literal TERM/KILL
controls for that child. No other ambient process/clock, direct filesystem or
network I/O, type-kind escape, alias, reexport or dynamic dependency is granted.
Core and start admission import openOfficialUpstream as a value through their
exact relative paths. Managed connection imports openOfficialUpstream and
OfficialUpstream as types through its exact path. All other source owners,
including adapters and unknown Official siblings, cannot depend on this lifetime,
even through erased syntax.

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
permission to split a transaction or widen its five dependencies. The launch and
upstream roles likewise grant only their named capabilities.
