# Desktop App deployment

The App delivers its own runtime, native helpers and the complete unchanged
official Server release. The thin Plugins carry the host-facing metadata,
HTTP configuration and Skill. See [desktop runtime](desktop-runtime.md) for
current Windows applicability, startup and the App's lifecycle.

## Building and evidence

### Installation authority and state

The deployment store remains a source-only prerequisite, outside App bootstrap,
main, activation and App restart-worker composition. The independent verification
worker described below belongs to contributor enrollment. Current native authority is
Windows-only. Ordinary native authority exposes read/shared-use through the
verified, intrinsically bound sibling query. The direct native factory rejects
unsupported hosts and ordinary writer requests before filesystem or native
acquisition. The unbound query and worker also refuse before I/O. The public store
entry points resolve the canonical installation path before requesting native
authority. The separate trusted worker open requires actual validated native
authority before exposing operation, commit or deletion. Per-user roles trust
code running as the same account. OS permissions cannot distinguish that
account's ordinary App from other code run by that account. Metadata kind and
environment values confer no writer authority. Unsupported default native entry
points refuse before resource acquisition. Explicit supplied Windows capabilities
in controlled tests do not authorize default native I/O on another OS.

Bounded Windows handle/SID/protected-DACL/local-NTFS source evidence and controlled
fixtures do not establish actual protected creation, permission/ACL readback,
native loading or installer/portable acceptance. Unknown results, unsafe ancestors,
links, cross-volume control entries, changed identities and missing fixed leases
refuse admission. Windows inherited control-file ACEs require the checked protected
parent template. Retained POSIX implementation branches and dated evidence are
historical or pending later source removal. Current support and distribution
cover Windows only. Complete original upstream files remain unchanged.

Coordinated storage fixtures cover complete state, actual leases and explicit
failure outcomes. Ordinary uncoordinated reading of the Windows state document
can coincide with failed or indeterminate publication. Simultaneous reader/update
availability remains unqualified. Controlled reader handshakes establish fixture
behavior only. Publication can still fail while the document is open. Stronger
availability needs later native production and admission qualification. The
complete-state, lease, explicit-failure and no-replay contracts apply.

Ordinary startup neither creates nor repairs a missing or partial envelope.
The installation schema, canonical identity formula and two persistent lease
inodes are unchanged. App admission stays disabled until the complete producer,
protected creation and native gates are integrated together.

### Fresh enrollment and verified payload

The explicit contributor-only `stageFreshDesktopInstallation` source composition
supports Windows x64 fresh enrollment and state-last initial publication. It
consumes the actual verified stage producer and owns a finite private build-only
query/create support lifetime. Default App admission, ordinary restart/update,
installer integration and native acceptance are pending.

The supported Windows stage produces and privately captures its actual query Q
before App/worker buffers and observer callbacks. Its intrinsic
`__DCT_DEPLOYMENT_QUERY__` expectation fixes platform/architecture, sibling name,
complete bytes/digest and PE/CLR structure. Q precedes buffers, manifest and build
identity. State, a caller digest or backend, an old executable and a runtime
compiler supply no trust. Creator, compiler and reference provenance stays
separate from runtime files. `generateAppFiles` and `check:app` are compile-free and explicitly
unbound. That worker refuses before file, native or process I/O. Unsupported native
cells refuse without architecture substitution.

The Windows stage producer composes its complete expected payload
from authenticated original ZIP entries, the selected original Node runtime,
actual generated App buffers/licenses/native packages and the complete unchanged
official release. The fixed extractor authenticates the same read-locked source
stream that supplies ZIP entries and their original byte hashes. Expected content
is composed from those inputs before the fresh output is written. The stage
includes canonical `payload-manifest.json`, which excludes itself from its
entries. The stage passes the complete read-only tree verifier against
the independently source-derived selection before returning.
`stageDesktopApp` returns the flat stage's `root`, canonical manifest, selection
and descriptive original-source/build-input provenance. This result grants no
runtime authority or protected publication capability. The tree verifier alone
still establishes observed content agreement. The Windows producer refuses
unsupported targets. Every target requires source extraction and license
evidence. The fresh consumer joins this production with native protected
creation before publishing an initial build. Actual platform permission,
compiler/runtime and installer acceptance remain pending.
The maintained Node runtime-file inventory currently enables Windows x64 only.
Windows arm64 staging still requires complete runtime-file and license evidence,
an architecture-specific source producer and native proof.

Fresh enrollment retains the stage producer's verified root directory identity
through the producer's scratch cleanup. Before destination or native
acquisition, it rechecks the canonical non-link directory and its device,
inode, mode, UID and GID. The copy uses that same producer identity. Controlled
fixtures reject a byte-identical directory replacement or changed metadata
before acquisition. This evidence covers source identity binding in the
contributor transaction. Protected native acceptance and the original-package
byte proof remain separate.

### Independent post-publication worker

After protected state-last publication and temporary reader/fixed/payload checks,
the fresh transaction retains operation/shared-use descriptors and successfully
closes temporary support once. It never calls that old reader/query again. The
parent verifies retained producer bytes/identities for fixed Node, query and
worker, then owns one hidden shell-free ordinary Node child and all stdio before
awaiting. The worker captures its own module and Node paths before any await. It
requires canonical `installationRoot/builds/<64-hex>/resources/app` placement,
and verifies the original Node and native loader, ordinary read/shared-use, own
build selection and complete payload. It repeats native, state and identity
checks, then releases its own use before canonical output. Parent success requires the exact retained state and actual
successful child exit plus settlement of all stdio. A response, EOF or a deadline
is insufficient.
No early lease release, kill, replay, rollback or new global ledger is added.
Close/spawn/read/output/release failures after publication remain indeterminate.
Normal Windows writers remain unavailable even in bound builds. Executing code
and original native loading remain trust boundaries. Hashes establish content
identity only. OS image selection, permissions and native execution require
their own evidence.

### Runtime inputs and local build

Complete the [trusted installation sequence](../policies/supply-chain.md#installation-and-scan-order)
first. App build checks reviewed
Electron/ordinary Node archives, the unchanged complete official npm release and
original native loader files, then collects licenses from actual esbuild inputs
and reviewed SDK vendor maps. Catalog and every connection receive the same
verified ordinary Node executable and original public bin. Electron never acts
as their Node runtime. None of those files is installed through the Plugins.

`pnpm check:app` statically verifies Windows x64 and arm64 bundles, complete
original native inputs, actual graph licenses and official bytes on any runner
OS without staging or native execution. For a local Windows stage, use archives
matching the [reviewed App inputs](../../tooling/app-release-inputs.json).

```powershell
pnpm build:app --portable --electron-archive <electron-zip> --node-archive <node-zip> --output <new-absolute-stage-directory>
```

The destination must be new. The builder never overwrites same-version content.
Its executable remains `electron.exe` at that flat root. The command produces
a local development stage only. Earlier Windows x64 extraction/native-loader
research predates the complete payload producer. The new producer's small inert ZIP
fixtures establish controlled producer behavior only. Real archive and native
acceptance require separate evidence. Signed installers, complete immutable
version retention and managed uninstall remain
separate deployment work. No background update service or rollback/pruning
mechanism is introduced.

### Optional dependencies and research seals

Owned App/research bundles explicitly disable ws optional `bufferutil` and
`utf-8-validate` loading through its supported compile-time opt-out switches.
WebSocket masking uses the bundled JavaScript implementation. Node 24's built-in
UTF-8 validation remains available. Optional native masking could be faster.
This delivery makes no performance claim and acquires no implicit addons. Emitted
imports must belong to Node builtins or the exact selected Electron/native App
closure. The unchanged original official release is delivered independently.

The test-only [HTTP gateway fixture](../../tests/fixtures/http-gateway.ts)
composes real Core and SDK HTTP. It refuses native start and restart without
`--allow-gui`. The [research seal](../../tooling/native-fixture-seal.ts) binds the fixture,
both complete screenshot study subjects, original native helpers and a complete App stage to actual source inputs/digest and independent
whole-file inventories. Study source launchers only verify and start the sealed
ordinary Node. Measured code verifies itself before native acquisition. The pure
verification module imports no builder or esbuild runtime. Execution uses only
this sealed closure.

The production manifest is included in the research receipt's App file inventory.
The thirteen research leaves and receipt algorithm remain independent. The extra
leaves deliberately exceed the production manifest and fail production complete-tree
verification. Older receipts document their original producer. Final native
evidence requires a clean committed revision and fresh seal. Fixture cleanup
and actual child exit, actual App GUI/singleton/exit, native target behavior,
host HTTP execution, installed metadata and host-rendered icons are distinct
acceptance surfaces.
