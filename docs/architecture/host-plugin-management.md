# Host Plugin management

The current App separates desktop selection/job ownership from one complete
Host synchronization transaction. It manages only the own Plugin through native
Codex and Claude adapters; hosts remain independent. App and Plugin 0.1.0 remain
Unreleased, with no production stable candidate or feed.

## Implementation owners

- [App host management](../../src/application/app-host-management.ts) owns admitted
    selections, cached summaries and actual native-job barriers, not payload proof.
- [Host Plugin manager](../../src/application/host-plugin-manager.ts) owns inspect,
    update/checkpoint, receipt restoration and URL synchronization as one transaction.
- [Native host adapters](../../src/adapters/native-host-plugins.ts) and
    [user intent](../../src/adapters/host-user-intent.ts) own concrete CLI/config
    evidence and refusal boundaries. [Git source](../../src/adapters/git-plugin-source.ts)
    verifies immutable source. [Host payload integrity](../../src/host-plugins/payload-integrity.ts)
    owns pure byte-map proof, endpoint evidence and the own URL literal overlay.
    [Verified Plugin files](../../src/adapters/verified-plugin-files.ts) owns
    filesystem tree reads, Claude leases and the complete atomic endpoint write/readback.
- [Managed receipts](../../src/adapters/managed-plugin-receipts.ts) retain only
    secret-free management provenance, not runtime ownership or a configuration mirror.

The dated [native management study](../evidence/host-plugin-research.md#native-user-plugin-management-study--2026-10-17)
owns exact executed versions, sources, input trees and native/activation limits.
The following explains maintained source, not a new native execution claim.

## Native selection and user intent

The adapter can resolve only the known executable name from its launch environment's
PATH; it never scans drives, installs a CLI or probes a signed-in session. Each
operation uses a neutral existing cwd, structured executable/args/env and
`shell: false`, with hidden helper windows and bounded time/output. Unrecognized
native version or output metadata fails closed.

Config roots are explicit. Codex receives child-only `CODEX_HOME` and reads that
root's `config.toml`; Claude receives child-only `CLAUDE_CONFIG_DIR`, with optional
`CLAUDE_CODE_PLUGIN_CACHE_DIR` as a separate plugin-root override. App data is not
a host config root. Standard bounded TOML/JSON parsing extracts only the own
marketplace source/ref/pin and own user enablement. Unrelated settings, headers
and tokens are neither rewritten nor retained in management summaries/receipts.

Both adapters inventory only `debugging-cdp-targets`. Their adopted operations are:

| Operation | Codex | Claude Code |
| --- | --- | --- |
| Catalog inventory | `plugin marketplace list --json` | `plugin marketplace list --json` |
| Own Plugin inventory | `plugin list --marketplace debugging-cdp-targets --json` | `plugin list --json` |
| Add genuinely absent catalog | `plugin marketplace add SOURCE --json` | `plugin marketplace add SOURCE --scope user --json` |
| Selected catalog refresh | `plugin marketplace upgrade debugging-cdp-targets --json` | `plugin marketplace update debugging-cdp-targets --json` |
| Initial own install | `plugin add debugging-cdp-targets@debugging-cdp-targets --json` | `plugin install debugging-cdp-targets@debugging-cdp-targets --scope user --json` |
| Own user update | `plugin add debugging-cdp-targets@debugging-cdp-targets --json` | `plugin update debugging-cdp-targets@debugging-cdp-targets --scope user --json` |

Codex list supplies neither installed path nor scope. Marketplace `source.path`
is not an installed cache path. Only this service's safe native add result can
establish its actual `installedPath` receipt. Cold existing installations or
catalogs without adequate ownership evidence remain unresolved/read-only;
there is no add-as-probe or guessed cache adoption. Add enables the Plugin, so
explicit user `false` blocks it. Selected catalog upgrade can force-refresh other
entries even at the same version; unrelated, disabled, pinned or unresolved
copies block automatic refresh. Structured errors are checked even at exit 0.
Configured refs hidden by list output are read from the selected TOML config.

Claude list separates `scope`, `installPath` and optional `readFromFolder`.
In-place copies remain read-only. Both advertised cache and actual in-place roots
are physically compared across every returned own-Plugin scope. A user cache
shared with project, local, managed or another scope cannot be patched; explicit
user `false` overrides merged enablement. Same-version native update may do no
work. The distinct-version native fixture is dated evidence, not a same-version
replacement guarantee.

Only Claude's exact installed-root `.in_use` directory is excluded from byte
comparison when it is readable, nonlinked, stable and empty. Nonempty, unreadable,
linked or changed markers remain in-use/read-only. The service neither deletes
nor decodes markers to acquire a lease. Canonical Git payloads forbid that root
marker. This narrow exception is grounded in the dated inspected 2.1.302 lease
implementation; it does not authorize arbitrary unknown installation metadata.

## Source, receipt and port synchronization

The supported future latest-record schema (not a published feed) has schema 1,
a stable Plugin version,
independent `minimumAppVersion`, Git URL and immutable lowercase 40-character
payload SHA. HTTPS sources cannot contain credentials, query or fragment;
loopback HTTP exists for isolated fixtures. Payload commit A precedes separately
authorized catalog/feed commit B. Both hosts' git-subdir catalogs must agree on
payload SHA, path and logical version. No history search or downgrade is used.

Before native effects, both catalog records and immutable source blobs are
validated without checkout, payload execution or Git hooks. Links, gitlinks,
escape and every case-folded file/directory-prefix alias are refused. After
native update, inventory must confirm the actual root, version, scope, source,
ref and enablement; exact full bytes, own manifest and transport are revalidated.
Only the proved `mcpServers['cdp-targets'].url` JSON literal may differ from source.
Headers, other entries, formatting and other files remain byte-identical.

A verified native replacement is checkpointed before later URL/persistence work.
Schema 1 management metadata stores actual paths/source, file hashes, original
strict loopback URL and unique UTF-8 byte offset. It stores no full MCP/header or
configuration mirror, bearer, connection or runtime state. Its explicit data
directory must already exist and be selected after App singleton admission.
Every restore and retry revalidates actual bytes and native/config ownership;
the service cannot absorb an external configuration change after its own command.
Explicit retry can finish a known replacement without repeating native update.
If its receipt never reached disk and the process is lost, a new instance lacks
that proof and remains read-only.

No candidate, an incompatible latest candidate or a stale older candidate does
not prevent a compatible, revalidated managed copy's new-port URL sync. Current
URL maintenance and update eligibility are independent. One host's failure does
not undo a successful peer. Atomic own writes check identity before effects and
read back immediately, including the narrow Claude lease check. No cross-process
compare-and-set spans config, catalog, native cache and URL rename; late movement
returns an explicit partial failure/retry. Disk/CLI success remains reload pending
until actual host activation is independently demonstrated.

The HTTP field/key basis matches maintained thin inputs: Codex `mcp.json` uses
`streamable-http`, Claude `.mcp.json` uses `http`, both own key `cdp-targets` and
default `http://127.0.0.1:27637/mcp`. The service accepts only a successfully bound
strict loopback `/mcp` endpoint for synchronization. Its CLI fixture supplies no
executable tools in the dated study and does not establish App HTTP discovery
or activation.

## Desktop selection and job barrier

The App constructs the concrete Codex/Claude Host Plugin manager, native adapters and
secret-free receipt store only after singleton/data admission. After successful
HTTP bind it independently restores/revalidates each selected host's owned
receipt and synchronizes its URL. Missing published candidates are ordinary in
0.1.0; no feed, polling URL or stable release is invented. A verified owned copy
can synchronize with a null candidate, and a stale compatible candidate never
downgrades it. Disk synchronization remains host reload pending; file readback
does not prove an active host session.
Inspect preserves that reload obligation for the same verified managed copy,
while showing current restrictions or native-read failure. A changed selection,
copy or provenance invalidates that pending-copy attribution.

Host summaries preserve missing CLI/plugin, native failures, no candidate,
disabled/pinned/read-only/shared restrictions and partial failure. Inspect host
and Sync / retry explicitly perform native work; ordinary dashboard refreshes
read cached host state. Hosts serialize independently. Explicit absolute
configuration roots and executable selections support different desktop
environments; Claude also supports a cache-root selection. Blank uses the App's
admitted user environment and home as neutral cwd. Selection changes refuse
while that host is busy and create a fresh idle adapter/manager. Receipts from
another root/selection never authorize adoption.

Save a desired port, restart normally through cleanup, bind the new endpoint,
then synchronize eligible hosts independently. A failed bind keeps the manager
available for a port correction and performs no host URL synchronization.
One host's failure does not roll back the other; retry the affected host and
reload it after successful disk synchronization. Quit denies new mutations and
waits for actual native CLI completion as well as normal Core cleanup.

The desktop barrier waits for each actual native chain; it does not replace the
manager's complete checkpoint/receipt/URL transaction. Summary polling does not
run CLIs. A UI wait or failed peer cannot authorize adoption, replay native update
or turn disk readback into host activation.

Current source tests use controlled I/O. Historical native fixture acceptance,
component rendering, production App interaction and six-platform delivery cells
remain separate evidence. No new native, GUI or reload acceptance is claimed.
