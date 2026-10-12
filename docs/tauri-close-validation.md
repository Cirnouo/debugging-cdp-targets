# Windows normal Close and Tauri validation

Windows normal Close selects the first eligible top-level window belonging to
the verified application process, posts `WM_CLOSE`, and waits for the original
native application handle to exit. Window disappearance and accepted message
delivery do not establish process exit. This record separates that window
selection behavior from application subprocess and data-directory cleanup.

The final 2026-10-12 Windows acceptance passed Tauri, Chrome, Electron and a
second Chrome connection on one reusable gateway. Each normal Close produced
actual native root exit, verified resource-group completion, whole-directory
deletion, an empty connection registry and a still-live reusable gateway. The
gateway then exited normally with code 0. Earlier failed cleanup attempts remain
recorded below, including three retained experiment directories.

## Window selection and application ownership

The native helper enumerates top-level windows for the exact launched PID. An
eligible window is visible and enabled, has no owner, has neither `WS_CHILD`
nor `WS_EX_TOOLWINDOW`, and has positive width and height unless it is minimized.
It chooses the first eligible window for compatibility with ordinary applications
that have multiple windows. It rechecks PID, HWND existence and qualification
immediately before posting Close. Executable path, creation time and Windows
session identity still guard the actual application process.

[Microsoft's EnumWindows contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)
defines top-level enumeration; the qualification rules are this repository's
native-close policy. [WM_CLOSE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-close)
allows application shutdown handlers and confirmation. The Plugin does not
force a process exit, close every window, restore a minimized window, or bypass
an application's shutdown decision. Multiple-window applications can remain
pending after one normal Close request. A cancelled or failed Close retains
ownership while the application remains alive.

Windows launch assigns the new application atomically to an anonymous native
job with no kill-on-close flag, limits or breakaway permission. Root exit still
revokes routing and cancels dependent work immediately. A separate owned
resource waits until an authoritative native job query reports zero active
processes before Close completion, restart successors or directory release.
Completion-port notifications and bounded waits trigger queries; elapsed time
and notifications alone never establish exit. Ordinary upstream/router cleanup
proceeds before this resource wait. Observation failure retains the claim.

The job observes inherited descendants, including later generations and nested
jobs. It does not establish ownership of arbitrary external brokers or unrelated
writers. Native job creation/query failures remain explicit failures; there is
no unobserved fallback launch or filesystem deletion retry. The implementation
uses the Windows 10 / Server 2016-or-newer job-list attribute documented by
[Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
with [nested-job accounting](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs).

The native regression fixtures cover ordered technical/application windows,
minimized application windows, no eligible window, multiple eligible windows,
selection races, window disappearance without application exit, and actual
native exit before resource release. See the
[interactive test inventory](../tests/interactive/README.md). Those owned native
fixtures and application acceptance are distinct evidence.

## Reproducible independent inputs

This experiment uses separately copied synthetic Tauri and Electron samples.
The supplied source, original running Tauri instance, original data directory,
user configuration, global Skills and installed Plugin cache remain untouched.
Copying used exclusive regular-file copies with different file identities,
refused links, and checked SHA256 before copy, after copy and after build.

The independent preparation copied 136 files: 43 Tauri source, configuration,
frontend and lock inputs; 10 Electron application inputs; and 83 Electron package
files, including the complete 73-file Electron distribution. Original Tauri build output,
application data directories and unrelated dependencies were excluded. Existing
frontend assets were hash-verified, so no npm installation or frontend rebuild
was required. The complete Electron runtime and its original licenses/resources
were preserved.

| Component | Exact identity or result |
| --- | --- |
| Host | Windows 11 Home, Chinese edition, x64; native version `10.0.26300`, build `26300` |
| Node / pnpm | `24.21.0` / `12.4.2` |
| Gateway / official Server | Unreleased `0.1.0` / unchanged `chrome-devtools-mcp 1.10.1` |
| Rust / Cargo | `1.99.0`, `x86_64-pc-windows-msvc` |
| Tauri sample / CLI | `0.1.0` / `2.12.2` |
| Tauri / tauri-build / opener | `2.12.3` / `2.7.2` / `2.7.1` |
| Wry / Tao / WebView2 COM | `0.57.0` / `0.37.1` / `0.39.1` |
| Live WebView2 | File/product `154.0.4258.62`; verified endpoint `Edg/154.0.4258.62` |
| Live Chrome | `155.0.8059.40` |
| Live Electron runtime | `44.5.1`, Chromium `152.0.7977.130`, Node `24.21.0`; static versions agree |

The new Tauri target directory was built with the following command, substituting
the actual newly allocated independent root for `<fresh-root>`:

```powershell
cargo build --locked --offline --features tauri/custom-protocol --manifest-path '<fresh-root>/tauri-vanilla-ts/src-tauri/Cargo.toml' --target-dir '<fresh-root>/tauri-target'
```

The initial build succeeded. A subsequent incremental build after adding pure
event observation also returned exit 0 in 25.82 seconds. It did not resolve or
upgrade dependencies. The observers write outside the managed data directory,
ignore trace-write failures, and do not prevent shutdown or add an exit fallback.
Tauri's `RunEvent` callback records Ready, CloseRequested, Destroyed,
ExitRequested and Exit using the
[exact Tauri source](https://github.com/tauri-apps/tauri/blob/5b23c82ea5ba6b9aec420dd71f60493edc486aa9/crates/tauri/src/app.rs).
Electron's observer preserves the sample's existing `window-all-closed` handler
and `app.quit()` behavior; the
[versioned application lifecycle contract](https://github.com/electron/electron/blob/v44.5.1/docs/api/app.md)
describes these events. The accepted Electron run recorded `close`, `closed`,
`window-all-closed`, `before-quit`, `will-quit` and `quit` with no shutdown veto.

The private development driver was invoked with these argument forms after
substituting the reviewed driver and independent input paths:

```powershell
node '<private-acceptance-driver>.ts' --allow-gui '<fresh-root>'
node '<private-acceptance-driver>.ts' --allow-gui '<fresh-root>' --tauri-only
```

The second form selects a single Tauri diagnostic and stops after that result.
The driver and external sample inputs remain private experiment artifacts;
this document does not install or distribute them. Reproduction requires the
same reviewed fixture source, locks and complete local runtime, together with
the recorded MCP launch, native observation and cleanup assertions.

| Prepared or observed artifact | SHA256 |
| --- | --- |
| Tauri executable before observers | `32d867fdb05e094dea059c0abf09ba1efecdf667b1ecc0ff27c34ee98044689b` |
| Tauri executable with event observation | `dcc59704a794d6f62cd3f12684ea8dd3f58a75cea9d11194dc29519041fdf063` |
| Observed WebView2 executable | `7e941ccb324fd87c849dca6356079e65a31ff264b8b5b37cc43d055b2764b9b3` |
| Complete copied Electron executable | `49b61a030a520fc36a4b8fa5cce53fb4e935a7bdbbe4b80e9222f598e49cc7fa` |
| Tauri package lock | `dacb5c58793e7ddc8ed9d37fc441d4885c2f06188c9894267ad5fbd1ea626021` |
| Tauri Cargo lock | `584512678e65ccdb88bcbd7ca5d3640b09d9427d21ce6a8d92288afa0d5b4eec` |
| Electron package lock | `1d18c80eebda9c1c6acc6b7bc68dc54fab79bdf47e79581889f8bfd0250daaaf` |

Repository supply-chain audits cover the repository npm graph and the unchanged
official Server graph. The externally supplied Cargo/sample/Electron/WebView2
inputs are a separate scope. File hashes, matching version receipts and locked
offline builds establish the recorded provenance and build behavior; they are
not a vulnerability audit of those external graphs.

## Isolation, occupancy and verification procedure

Before each launch, read-only process inspection checked the exact executable
and related application processes, existing effective data roots, and fixture
namespace attribution. Existing applications with unrelated verified roots
remained untouched. Static sample inspection found no single-instance plugin,
shared instance lock, shared namespace request or writes to an application-wide
state directory. The gate depended on the actual independent executable,
binding and occupancy evidence, rather than a framework's multi-instance claims.

The Tauri configuration has `create: false`; its setup constructs that configured
window with `.data_directory(CDP_TEST_DATA_DIR)`. The gateway substitutes the same
new real leased directory into `CDP_TEST_DATA_DIR` and
`WEBVIEW2_USER_DATA_FOLDER`, and substitutes the selected port into
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port={port}`. Actual
WebView2 argv adopts `<lease>/EBWebView`. Each launch requests a new random leaf
under a prepared independent parent and preauthorizes whole-directory
`delete-on-release`. No old directory or fixed Chrome profile fallback is used.

The test driver uses the generated Codex gateway over official MCP stdio and
the existing lifecycle client. It verifies native root identity, loopback
listener ownership, a browser-level endpoint and routed official `list_pages`
before Close. Explicit selected configuration and original start operation
metadata supply path/cleanup evidence; default summaries and Hooks carry no
paths. Native witnesses open original process handles before Close and retain
them through observation. The diagnostic attempt also captures every known
descendant's executable and creation time, then reads its actual exit FILETIME
with `GetProcessTimes`.

GUI tests and smokes skip successfully without the exact `--allow-gui` argument.
Local authoring and application verification explicitly pass it. This experiment
uses a private ignored driver and reviewed external fixtures; it adds no Tauri,
Electron, Cargo or GUI acquisition to CI. The existing Windows interactive CI
lane exercises native core fixtures. Its results cannot establish these
application controls, and these controls cannot replace the native CI lane.

Complete application acceptance requires all of the following for each new
connection: normal lifecycle Close; native root and required resource-user
exits; original start metadata showing released cleanup; `lstat` returning
`ENOENT` for the leased directory; an empty connection registry; and a still
usable gateway. The executed same-gateway sequence was Tauri, Chrome, Electron,
then Chrome again. A failure stops later launches and preserves owned state.

## Observed window evidence

The second Tauri launch exposed the following top-level native windows before
Close. Values are the actual observed geometry and style values, not static
window-creation arguments:

| Window | Visible / enabled / owner | Bounds | Style / extended style | New eligibility |
| --- | --- | --- | --- | --- |
| `Tauri Window` | true / true / none | 814 x 638 | `349110272` / `262416` | Eligible |
| `Tao Thread Event Target` | true / true / none | 14 x 14 | `2483027968` / `134742176` | Excluded by `WS_EX_TOOLWINDOW` |
| `MSCTFIME UI` | false / false / owned | 0 x 0 | `2348810240` / `0` | Excluded |
| `IME` | false / false / owned | 0 x 0 | `2348810240` / `0` | Excluded |

Read-only `.NET MainWindowHandle` and the new first-eligible selection both chose
the real Tauri window in this instance. The historical wrong selection was not
reproduced in this application run, and no Close was sent through the old
selector. The original incident's first selected HWND is not established by
this evidence. The ordered native regression separately demonstrates the
technical-window selection failure and the corrected selection behavior.

## Application results and cleanup timing

The final acceptance used the committed native resource-barrier implementation
`a6f5606` and the exact delivered assets below. Before-launch and after-Close
SHA256 receipts matched for all three files in every one of the four runs.

| Delivered Codex gateway asset | SHA256 |
| --- | --- |
| `mcp-bootstrap.mjs` | `c17d3dbc4c296f2453a89a278bd01ae0275ce94662536a38d069505b5770a481` |
| `windows-native-helper.ps1` | `8a146d491af5c47867e524a9d3ceb387396638e73547467afc91dd14f154fc22` |
| `windows-native-process.cs` | `b0356c08c2b1f88b8a245b9eb9b6a1e3f3905e24fdaaca5c7ef0da9be2c6d328` |

Each row represents a new independent connection on the same gateway. The
durations measure the explicit Close operation, including native helper setup
and cleanup; they are observations rather than performance promises.

| Run | Verified browser product | Close duration | Actual root exit / job zero / directory / registry |
| --- | --- | --- | --- |
| Tauri | `Edg/154.0.4258.62` | 4,978 ms | Native exit 0 / zero active processes / deleted and absent / empty |
| Chrome | `Chrome/155.0.8059.40` | 5,013 ms | Native exit 0 / zero active processes / deleted and absent / empty |
| Electron | `Chrome/152.0.7977.130` | 4,581 ms | Native exit 0 / zero active processes / deleted and absent / empty |
| Chrome reuse | `Chrome/155.0.8059.40` | 4,730 ms | Native exit 0 / zero active processes / deleted and absent / empty |

The private observer passively records the delivered native helper's existing
`exited` and `resources-closed` output, without altering the producer or reading
official Server/page output. The runtime validates resource receipts against the
actual root identity and requires `activeProcesses: 0`. These receipts establish
the complete owned job's completion, including members created after a finite
PID snapshot. Independent retained root handles supply actual-exit receipts.

| Run | Root-exit receipt UTC | Verified job-zero receipt UTC | Directory removal UTC |
| --- | --- | --- | --- |
| Tauri | 13:46:37.787 | 13:46:37.882 | 13:46:37.887-13:46:37.921 |
| Chrome | 13:47:18.086 | 13:47:18.091 | 13:47:18.108-13:47:18.179 |
| Electron | 13:47:57.074 | 13:47:57.078 | 13:47:57.106-13:47:57.117 |
| Chrome reuse | 13:48:35.332 | 13:48:35.338 | 13:48:35.356-13:48:35.428 |

All times in this table are receiver UTC on 2026-10-12. Every removal starts
after the corresponding validated job-zero receipt. In Tauri's additional
eight-process native witness, the actual root exit FILETIME was
13:46:37.7801448Z and the last known descendant exited at 13:46:37.8801036Z,
both before the job-zero receipt. Every retained handle returned wait result
0, wait error 0 and exit code 0. Original start isolation metadata showed
`deleted`, `lstat` returned `ENOENT`, and no listener remained after each Close.
The successful gateway reuse and final stdin-EOF exit with code 0 are separate
checks from application shutdown. These were ordinary-integrity application
runs; they do not add actual UAC acceptance.

### Earlier investigation and preserved failures

Before the resource-barrier correction, three independent Tauri creations
occurred. The first stopped
at a read-only evidence-helper failure before lifecycle Close; a separately
authorized recovery normally closed the owned target through the native adapter.
Its root and WebView2 listener supplied actual native exit receipts with code 0.
The owned test driver alone was later disposed after verified app exit so the
gateway received EOF and exited naturally with code 0. An empty `EBWebView`
directory remained. This recovery is separate from full gateway Close acceptance.

The next two pre-correction Tauri attempts issued lifecycle Close. Both reached the sample's
CloseRequested, Destroyed, ExitRequested with no programmatic exit code, and
Exit events. Both operations failed at `closing-resources` with
`directory-cleanup-failed`. The diagnostic attempt captured the underlying
`EBUSY`, `unlink`, errno `-4082` through the existing closed diagnostics channel.

| Diagnostic event | UTC on 2026-10-12 |
| --- | --- |
| Tauri root actual exit, code 0 | 12:47:26.9037866 |
| Tauri console host actual exit, code 0 | 12:47:26.9066888 |
| Directory remove begins | 12:47:26.926 |
| Directory remove fails with EBUSY | 12:47:26.930 |
| Known WebView2 child actual exit, code 0 | 12:47:26.9341383 |
| Known WebView2 child actual exit, code 0 | 12:47:26.9459715 |
| Known WebView2 child actual exit, code 0 | 12:47:26.9680404 |
| WebView2 listener actual exit, code 0 | 12:47:26.9904111 |
| WebView2 crashpad actual exit, code 0 | 12:47:27.0092777 |

A known renderer also exited with code 0 at 12:47:26.8684494. All eight exact
processes had retained handles before Close. The directory remove interval
precedes several known descendant exits; application root exit alone did not
establish that these resources had stopped using the leased directory. The
closed channel does not expose the failing path or file handle, so this record
does not attribute EBUSY to a specific file or identify its owner.

The pre-correction diagnostic gateway removed the connection route, reported an empty registry,
and kept the original start operation's explicit isolation metadata at
`cleanup-failed`. The successful start result remains historical launch evidence.
The failed Close result remains failed. No managed leaf was manually removed and
no application was force-killed. At final read-only cleanup inspection, the two
failed gateways and their drivers were already absent, so no later EOF retry
could be dispatched to them. Their exit cause and native exit receipt are
unavailable; the record does not invent a normal shutdown. Three earlier leaves
remain: one empty `EBWebView`, one `EBWebView/Default/DIPS`, and another empty
`EBWebView`. Their exact absolute paths stay in private evidence and must be
reported to the experiment owner. The final four accepted connections use new
leaves, all of which were deleted.

A preliminary Tauri/Chrome pass before the final completion-key guard and an
additional Tauri pass stopped before another Chrome acquisition are retained
as supplementary evidence. Their empty gateways received explicitly selected
stdin EOF and exited normally with code 0. They do not replace or extend the
final four-run matrix above.

## Evidence limits

Raw process argv, paths, filesystem receipts, MCP results and observer logs stay
in ignored private experiment artifacts. This committed record contains selected
versions, hashes, geometry, timings and outcome facts, without personal absolute
paths, tokens, cookies or private page contents. No screenshot was requested.

The pre-close snapshot identifies known descendants; the separate native job
query covers inherited members created later. Neither establishes arbitrary
external-broker ownership. Native exit timestamps establish the captured process
order, while diagnostics wall times have millisecond resolution and include
synchronous observer delivery. The observed gaps are reported directly;
this experiment does not measure observer overhead or generalize to every Tauri,
WebView2, Electron or Windows version.

The evidence-helper preflight also exposed Windows PowerShell 5.1 module loading
from inherited PowerShell 7 module paths and a multiple-identity JSON-array
limitation in an existing observer. The private driver selects the installed
Windows PowerShell module roots for its own children and uses separate original
root/listener witnesses. These are test-process adjustments, not user
configuration or production changes.

For normal recovery and retained directory reporting, see
[troubleshooting](user-guide/troubleshooting.md#normal-manual-close). The separate
[Tauri screenshot experiment](tauri-screenshot-validation.md) retains its own
failed qualification and helper-disposition history; this Close experiment does
not change its screenshot compatibility result.
