# I/O adapters

- `app-parent-exit.ts` validates exact-parent readiness and actual-exit evidence
  from a controlled read-only producer. It implements no native watch or Close
  request and is not integrated into App startup.
- `app-deployment.ts` opens only already enrolled installation metadata, validates
  physical root/native private-account permissions and holds exactly operation
  and use lock inodes. Its bounded canonical state store preserves removal fences
  and distinguishes pre-commit failure from indeterminate replacement/readback.
  It stages/removes no payload and is not integrated into App startup. Initial
  store inputs are Linux ext-family/tmpfs/XFS/Btrfs only; Windows ACL, macOS and
  system-DEB role producers are required before those platforms use admission.
  Filesystem IDs bound the supported mechanism, not power-loss durability.
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
  executing or repairing delivery inputs.
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
- `official-server.ts` validates the delivered release before resolving its public Server bin and validates options.
- `official-package.ts` verifies the complete official release tree and returns its original bytes.
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
