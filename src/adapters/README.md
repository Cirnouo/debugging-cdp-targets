# I/O adapters

- `app-parent-exit.ts` validates exact-parent readiness and actual-exit evidence
  from a trusted read-only producer. Windows retained-handle status and Unix
  positive absence are distinct; Unix records claim no exit status.
- `app-parent-watch.ts` captures native self identity and observes only the actual
  bridge parent through narrow Linux proc reads, a fixed read-only Windows helper,
  or a macOS libproc/JXA source candidate. No App startup/worker wiring or native
  acceptance is established. Both macOS architectures still require actual ABI,
  JXA loading, buffer and errno proof; helpers never request parent Close.
- `app-deployment.ts` opens enrolled installation metadata and holds exactly
  operation and use lock inodes. Normal open exposes read/shared use; the separate
  trusted writer validates native authority before operation, commit or deletion.
  Its bounded canonical state store preserves removal fences, changed-document
  refusal and pre-commit versus indeterminate outcomes. It remains outside App startup.
- Its explicit fresh contributor composition owns the concrete native build
  lifetime and reopens readers with newly sampled facts. Normal Windows admission
  fails closed while delivered query binaries remain pending; no runtime build
  fallback, caller receipt, backend or authority registration exists.
- `app-deployment-native.ts` produces actual native account/entry evidence and
  fixed Windows x64 current-account fresh directory/no-replace operations for
  the explicit contributor builder. Same-boundary Windows path collections use
  bounded fresh batches; dedup never weakens managed-entry purpose predicates.
  Fresh payload sweeps union all recorded entries and parent chains per boundary,
  with a new complete permission sweep on each side of content verification.
  Windows reader root/envelope and fixed-inode collections coalesce only within
  their original boundaries; document reads and lease effects retain their order.
  `windows-deployment-create.cs` is its separate build-only mutation entry,
  reusing the read-only `windows-deployment-authority.cs` inspector/query entry.
  Protected DACLs are supplied at creation; source handles and parent handles
  remain held during no-replace rename. Its finite copy entry owns only payload
  directory/file creation, write/flush/checked close/reopen/readback. Each file
  boundary resamples the unchanged native permission predicates while holding
  actual parent handles; Node retains content provenance and publication order. No existing ACL repair or elevation is
  provided. Common ancestor DACL admission, actual native behavior and other OS
  creation remain unaccepted; these sources do not enable App admission.
- `windows-deployment-support.ts` owns the fixed Windows x64 compiler/source/
  reference recipe, inert PE structure checks, actual output receipt, exclusive
  materialization and finite invocation lifetime. It accepts no caller helper
  path or receipt. `windows-deployment-protocol.ts` owns strict finite UTF-8 wire
  framing and actual byte/count query packing; `windows-deployment-stream.ts`
  drains both pipes during backpressured input and retains child/stdio terminal
  ownership after failures. These build-only EXEs and C# inputs are excluded
  from generated App delivery. Compilation, runtime/signing and native admission
  remain separate gates.
- `macos-deployment-authority.jxa` provides read-only descriptor/UID/ACL/local-APFS
  source evidence with exact returned masks. Controlled source checks do not
  establish native acceptance on either architecture. Filesystem IDs bound the
  supported mechanism, not power-loss durability.
- `app-singleton.ts` holds the advisory kernel lock descriptor for the App's
  lifetime in a native-account namespace independent of selected data roots.
- `app-activation.ts` provides only a bounded fixed activation frame and reply;
  it carries no management requests, credentials or settings.
- `app-storage.ts` selects separate installed and portable data roots and admits
  their creation only after singleton ownership.
- `app-chromium-storage.ts` creates per-process temporary Chromium roots
  synchronously before asynchronous bootstrap work, separate from configuration.
- `app-configuration.ts` validates the whole migration chain before a backup and
  atomic settings replacement, keeping desired port separate from effective port.
- `app-native.ts` verifies the complete original native loader closure before
  loading its original public shared/exclusive advisory-lock API. Callers without
  an explicit validated shared option retain exclusive behavior.
- `app-delivery.ts` verifies immutable archive and regular-file evidence without
  executing or repairing delivery inputs. Its separate payload verifier compares
  a complete canonical manifest and observed tree with independently expected
  content identity, OS and architecture. It returns content evidence only;
  trusted provenance, native authority, enrollment and lifetime admission remain
  caller obligations. No App startup consumer is enabled by this module.
- `native-host-plugins.ts` manages only the own user plugin through separate
    Codex and Claude native CLI contracts, preserves user intent and consumes
    actual install receipts instead of constructing cache paths.
- `host-user-intent.ts` reads only the explicitly selected user configuration
    with standard TOML/JSON parsers and extracts the own source/ref/enablement.
    Unrelated settings never enter the normalized management receipt.
- `git-plugin-source.ts` verifies both latest catalogs and the immutable Git
    payload blobs without executing or checking out plugin code.
- `verified-plugin-files.ts` owns filesystem evidence, paths, sharing and leases,
    consuming pure `../host-plugins/payload-integrity.ts` byte proof around the
    complete atomic own-URL write and immediate readback. Only Claude's
    exact empty `.in_use` host directory is excluded from installed comparisons.
- `managed-plugin-receipts.ts` persists schema-one App management metadata in an
    explicit existing App data directory and verifies it again after restart.
    The App must admit its singleton/data root before constructing the store;
    receipts contain no bearers, connections, live sessions or host output.
- `fixture-diagnostics.ts` owns opt-in fixture observation, direct I/O scopes,
  closed safe event/error metadata and receiver-side exception containment.
- `cdp-router.ts` forwards loopback HTTP/WebSocket CDP and tracks requests.
- `lifecycle-tools.ts` declares registration and six owned lifecycle/operation interfaces.
- `app-official-runtime.ts` verifies bundled ordinary Node and the complete
  unchanged official release before injecting both catalog and connection spawns.
- `tool-catalog.ts` exposes the fixed official catalog, parameter variants,
  complete reviewed Tool validation, actual connection enablement and configuration
  recipes/workspace sources.
- `gateway/official/server-launch.ts` owns invocation-time environment/platform
    defaults, child environment capture and explicit verified public-bin resolution;
    adapters consume that exact owner without changing their preflight/spawn order.
- Complete official package-file verification is owned by
  `gateway/official/package-files.ts`; runtime and launch adapters consume that proof.
- `file-evidence.ts` reads regular-file evidence through one descriptor, rejects
  path/metadata changes and closes the descriptor on success or failure.
- `mcp-bridge.ts` connects the official Server through the public SDK Client,
  closes its public transport independently of actual child exit, and owns
  bounded stdin/TERM/KILL disposal for that Server child. Capability-gated native
  SDK listChanged drives uncapped serialized private reviewed snapshots, freshness,
  fail-closed admission and captured Tool output validation.
- `mcp-http-server.ts` composes the public SDK Node Streamable HTTP transport,
  validates loopback HTTP boundaries and routes strict modern requests beside
  sessionful legacy connections through one shared Core.
- `mcp-request-handler.ts` owns the common fixed declarations, authenticated
  dispatch using the pure `gateway/owned-tool-arguments.ts` parsers, modern roots
  preflight before lifecycle acceptance, bounded form continuation around one
  Core execution and active-request progress routing.
- `target-host.ts` launches and verifies a newly created target. Its Chrome preset
  adds `--disable-updater-scheduler` to suppress automatic updater startup in
  the debugging process and fixes Windows screenshots with one bare
  `CDPScreenshotNewSurface` feature before profile acquisition or spawn.
  Conflicting feature choices fail and release the transient port claim; exact
  recovery preserves the composed arguments.
- `chrome-profile.ts` checks native profile locks and reserves canonical directories.
- `data-directory.ts` acquires canonical directory leases, inspects entry presence,
  rejects overlapping claims and retries authorized cleanup with identity checks.
- `port-reservation.ts` reserves CDP ports synchronously for one gateway and
  checks owner identity before releasing a live-run claim.
- `platform-process.ts` obtains OS identity/reservations and normal shutdown;
  Linux root creation evidence preserves kernel start tick precision.
  Darwin verifies mapped hard-link aliases against the installed executable's
  device/inode, and failures retain bounded executable identity metadata.
  Unix normal close validates the owned application identity and requests
  shutdown; actual Node child exit completes the separate unbounded wait.
- `windows-cdp-helper.ps1` supplies Windows process/listener evidence.
- `windows-launch.ts` validates the native helper protocol and actual app events.
- `windows-native-helper.ps1` orchestrates native launch/close, permission waiting
  and authenticated one-shot elevation with private structured data transfer.
- `windows-native-process.cs` owns Win32 handles, permission/manifest evidence,
  environment-preserving process creation, pipe authentication and WM_CLOSE.
- `AGENTS.md` defines I/O safety and platform contracts.

The accepted [isolation design](../../docs/adr/0015-explicit-data-directory-isolation.md)
defines filesystem acquisition/disposal with real-root identity, overlap claims
and authorized whole-directory cleanup. The target host binds the acquired opaque
path without an implicit fixed Chrome profile and preserves native ownership checks.
It checks explicit Chrome profiles in both isolation modes. Omitted default roots
and generic application occupancy require the Agent's read-only prelaunch gate;
the runtime does not guess their identity or a universal lock convention.

The App uses public `@modelcontextprotocol/client`, `server` and `core` SDK
2.2.0 and Node HTTP transport 2.1.0. The original official child retains its
public stdio interface. Host HTTP requests supply their own roots, form
elicitation, progress and cancellation facilities. Catalog pages are walked
without the SDK aggregate page cap; output schemas remain original. See the
[HTTP cancellation boundary](../../docs/app-runtime.md#request-lifetime).
