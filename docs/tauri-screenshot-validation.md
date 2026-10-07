# Fixed Tauri fixture screenshot validation

The minimal Windows Tauri fixture has **two failed candidate qualification
attempts and one cumulative actual application creation**. The original attempt
failed during permission inspection before application creation. A separately
authorized corrected build launched once but its target exited before CDP
readiness. Actual cumulative counts are **zero formal cells, zero reverse-order
cells, zero screenshot requests and zero PNGs**. Neither qualification passed;
there is no screenshot compatibility or feature-benefit result.

Both failure receipts retain **`cleanup.ok=false`**. Separate human decisions
later authorized abnormal termination of each retained Node gateway, after
which their probes and drivers ended naturally. Final observations found no
remaining owned resources. These dispositions ended the experiment without
converting either failed cleanup into normal application Close or gateway
shutdown. No additional launch is authorized.

This is a separate follow-up to the
[existing application experiment](application-screenshot-validation.md).
Readest remains excluded before acquisition, and the historical Obsidian matrix
and its cleanup observations remain unchanged.

## Original fixed source and build

The externally built package is `dct-tauri-screenshot-fixture` **0.0.1**.
Direct dependencies pin Tauri **2.12.1** with default features disabled and
`wry`, `devtools`, `custom-protocol` enabled, tauri-build **2.7.1** with default
features disabled, and serde_json **1.0.145**. The actual lock resolves Wry
**0.57.0**, Tao **0.37.1**, and WebView2 COM/sys **0.39.1**. These are build
identities; no running Tauri/WebView2/Chromium version was qualified in either
attempt.

The official fixed
[Tauri source](https://github.com/tauri-apps/tauri/blob/30da1fd6e17de6107ecc850c95dfb16b5729f2dd/crates/tauri/Cargo.toml)
and
[Wry Windows implementation](https://github.com/tauri-apps/wry/blob/792d0359ba6501a4fc360ece17de2ae42329a47c/src/webview2/mod.rs)
were matched against acquired source. The published Wry crate retains its
`dirty: true` VCS marker; the complete Windows implementation file independently
matched the fixed official commit byte-for-byte. Every acquired registry
archive was checked against the fixture's complete lock checksum. Original
sources, archives, licenses, resolved graphs and build receipts are retained
outside the repository.

The locked release build used Rust/Cargo **1.99.0**, MSVC **19.51.36247** and
host/target `x86_64-pc-windows-msvc`, returning exit **0** on 2026-10-07. Eight
isolated Rust profile-validator tests passed, with zero failures or ignored
tests. They ran test harnesses; they did not run the application's `main`.
Source/build review independently confirmed the fixed executable and complete
source inventory. File inspection found an x64 PE of **7,629,824 bytes**, string
FileVersion/ProductVersion **0.0.1**, numeric versions **0.0.1.0**, and an
`asInvoker`/`uiAccess=false` manifest preserving Common-Controls. Its imports
require no adjacent WebView2Loader, VCRUNTIME or MSVCP DLL. An installed
WebView2 runtime remains an external prerequisite.

| Fixed artifact | SHA256 |
| --- | --- |
| Fixture executable | `f7199ca3106477081279c49d0caa3ff98b7fb777e6e66aa7dc3b47713b6da5da` |
| Complete fixture Cargo.lock | `afa684c40c4cda685ad08ebbfc335cbc71811df66fd109b2fc8ec702bc6a4246` |
| Raw PE manifest resource, 595 bytes | `7f796983a5ca21f61c3a4c2a2d3926756d3080bdbc3786331bfb4f3f4bf95a88` |
| `mt`-extracted serialized manifest file, 630 bytes | `3e58607d4d7263f89ff7344ff7883232f117d6a1f4f17a5af088058a5fd84ba1` |

The raw resource and extracted file are different representations. Their
separate hashes and lengths matter to the qualification failure below.

## Audit scope

The complete fixture lock contains **393 packages**, including **392 registry
crates**. Its cargo-audit **0.22.2** audit used `--deny warnings` with no ignores
and returned exit **1**: zero vulnerability matches and two informational
warnings. Both findings remain retained:

| Package | Finding | Active Windows graph |
| --- | --- | --- |
| proc-macro-error 1.0.4 | [RUSTSEC-2024-0370, unmaintained](https://github.com/rustsec/advisory-db/blob/ef6173cbc5c50ec8166f9a5b28f07834144373ee/crates/proc-macro-error/RUSTSEC-2024-0370.md) | Absent |
| glib 0.18.5 | [RUSTSEC-2024-0429, unsound VariantStrIter](https://github.com/rustsec/advisory-db/blob/ef6173cbc5c50ec8166f9a5b28f07834144373ee/crates/glib/RUSTSEC-2024-0429.md) | Absent |

Independent review reconstructed the Windows closure from locked, platform-filtered
Cargo metadata: **239 packages**, **238 registry archives** and **585 resolved
edges**, including Windows host/build dependencies. The separately named
audit-only lock retained exact selected identities, checksums and edges; its
audit returned exit **0**, zero vulnerabilities, zero warnings and no ignores.
It was never used to build. The build used the unchanged complete lock.

Both audits bind the official RustSec database at
`ef6173cbc5c50ec8166f9a5b28f07834144373ee` through the retained command, clean
checkout and advisory file evidence. Acceptance applies to this fixed Windows
artifact audit scope. It does not establish a clean complete dependency graph,
waive either finding, or cover another host, target, feature set or resolution.

## Reviewed fixture and comparison contract

The owned source has one static embedded page and one main WebView/window,
with title `DCT Tauri Screenshot Fixture`, class `DctTauriScreenshotFixture`,
label `main` and 960 by 640 logical dimensions. Configuration declares no
automatic windows; the source validates the consumed fresh profile before
creating its explicit window. It registers no separate application plugins,
commands, updater, protocol associations, tray or close-prevention handlers.
The frontend has no page scripts, external resources, storage or animation.
DevTools is enabled for the release build without opening a DevTools window.

The fixture requires `WEBVIEW2_USER_DATA_FOLDER` to identify an existing fresh
`webview2-profile` directory beside its `native` working directory, containing
only the exact owned marker. It supplies the validated path explicitly to
the builder's data directory and JSON-encodes the consumed path in renderer
metadata. This avoids the identified
[Tauri default AppData fallback](https://github.com/tauri-apps/tauri/blob/30da1fd6e17de6107ecc850c95dfb16b5729f2dd/crates/tauri/src/manager/webview.rs#L559).
The harness separately checks fresh-directory ownership; the source contract
does not establish all runtime filesystem writes or defeat filesystem races.
The fixed
[Windows protocol mapping](https://github.com/tauri-apps/tauri/blob/30da1fd6e17de6107ecc850c95dfb16b5729f2dd/crates/tauri/src/protocol/mod.rs#L32)
and app-asset path derive the expected URL
`http://tauri.localhost/fixture.html`. Neither attempt qualified that runtime
URL, native window or renderer metadata.

The reviewed launch pair specifies a verified copy of the same executable,
empty host argv and a fresh profile for each arm. Its
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` carrier declares the controlled port
and loopback address. Baseline means **not explicitly enabled**, with no
explicit target-feature disable; candidate adds exactly one bare
`--enable-features=CDPScreenshotNewSurface` token. Actual browser argv adoption
is required independently of host metadata and does not query Chromium's
internal FeatureList.

The opt-in test helpers validate this closed fixture kind, unique existing
renderer and HWND, separate host/browser native identities, actual profile and
feature-carrier delivery, listener/session ownership and normal Close with
actual exit. They preserve the one-shot screenshot sequence, 60-second gateway
and 90-second client bounds, and saved PNG receipts before pixel decoding.
No product runtime/public schema, application preset, generic feature injection,
official Server, root dependency/lock or committed Plugin dist change is part
of this follow-up.

## Original qualification failure and retained cleanup

The one candidate foreground-normal qualification used helper source
`76d0bdb1015914af12418f84983b174afbad3349` and the completely verified sealed
Codex payload from `eef90b4d974600c3a6697d40dc76e99037466315`. It failed at
`inspecting-permission` with `MethodInvocationException` and native error **0**,
before reaching the native launching phase or acquiring an actual application PID,
listener or endpoint. The qualification-attempt allowance was consumed.

Independent read-only review called the same frozen `NeedsElevation` method
against the unchanged copied executable under Windows PowerShell **5.1**.
It reproduced the inner `System.Xml.XmlException`: the raw manifest contains
whitespace before its XML declaration, rejected at line 1, position 4. Reading
the raw 595-byte resource with the same XML reader also failed; the normalized
630-byte `mt` extraction parsed successfully. The original gateway error did
not expose that inner exception. The read-only reproduction and frozen source
ordering establish the parser mechanism and that this attempt created no
application; they do not establish a running privilege level or browser behavior.

Final gateway status reported an empty connection list, but cleanup reported
**`cleanup.ok=false`** in the probe receipt. Normal Close was rejected because
the referenced connection was absent, and no identity-bound actual-exit witness
was available.
The probe retained gateway stdio; gateway shutdown/exit and the driver's final
process exit were then unconfirmed. Read-only observations found no matching
fixture process or relevant listener at their observation time. Such absence
observations do not replace actual exit evidence or make cleanup complete.

No formal or reverse-order cell ran in this original phase. There was no retry,
channel change, replacement candidate or screenshot replay. Further launches
were blocked and the original one-qualification allowance was exhausted.
Profile adoption, runtime versions, browser argv/feature state, renderer/HWND
identity, runtime isolation, normal application Close and screenshot pixels
were unqualified. Source/build acceptance could not supply those observations.
The original failed attempt and cleanup remain unchanged by the separately
authorized continuation below.

## Separate corrected build and authorization

The human authorized termination of only the identity-confirmed original Node
gateway that had created no application. It exited abnormally with code **-1**;
the probe and driver then ended naturally, with driver exit **1**. Subsequent
observations found that owned helper chain and its listeners absent. No target
application was terminated, and the original cleanup result remains false.

The corrected external source removes only the 55-byte XML declaration text
from the owned manifest, retaining its following LF and every other source
byte. Independent review confirmed unchanged document elements, `asInvoker`,
`uiAccess=false` and Common-Controls semantics. The complete lock, Rust/config/
frontend/icon files, framework, Wry and compiler versions are unchanged. The
locked offline release build returned exit **0** and eight guarded release unit
tests passed. They ran test harnesses, not application `main`. The original
complete-lock warnings and accepted Windows audit scope were reused; no fresh
advisory scan was run.

| Corrected artifact | Identity |
| --- | --- |
| Executable size | 7,631,360 bytes |
| Executable SHA256 | `a2a2a71691c4e671f92e11dc6c15904ab39ce0050cd692de23f099c8580d99cf` |
| Raw manifest resource | 540 bytes |
| Raw manifest SHA256 | `6d1a7845a9529507bb49095623b817e09f0e2aa67d543aff4305fe2f8d2e90f6` |

Read-only Windows PowerShell **5.1** inspection against the same frozen native
C# returned **`false`** from `NeedsElevation`, without an exception. The exact
540-byte raw resource parsed under the strict XML reader: whitespace precedes
the assembly element, with no XML declaration. Its x64 identity, string
versions **0.0.1**, numeric versions **0.0.1.0** and relevant import set were
independently confirmed. These checks remove the raw-resource parser blocker;
they do not establish successful application or browser readiness.

The human granted **one additional qualification attempt**, preserving the
original failed attempt and counters. Up to twelve formal cells required
independent qualification acceptance and confirmed normal cleanup. The new
envelope allowed no reverse-order cells, automatic retries, channel changes
or application force termination. This was a separately reviewed allowance
against the corrected artifact, not a reset of the original phase.

## Corrected qualification: target exit before readiness

The corrected candidate foreground-normal qualification used frozen helper
source `e0a7dbd9c638ec0ca21264e0ce784fe9dffa7b6f` and the same completely verified
sealed payload. Its native operation progressed through launching into
`waiting-cdp`, then failed with **"The target process exited."** and
`processExited=true`. Independent review of the frozen native CreateProcess,
started notification and target-host readiness ordering establishes **one
actual fixture application creation** in this attempt, versus zero originally.
The native handle observation supports target exit before readiness; the public
receipt does not expose the actual target PID/creation-time tuple or numeric
exit code.

No browser endpoint/listener ownership, main renderer/HWND, actual browser argv
or feature-carrier adoption, consumed profile, runtime CDP version or normal
target Close was independently qualified. Native application stdio was directed
to NUL, so application stderr was unavailable through this route. The exact
startup-exit cause remains unknown. Source/build and parser acceptance do not
explain that exit.

The fresh profile contained `EBWebView/Last Version` reporting **154.0.4258.62**
and Variations data. These are filesystem observations of initialization
activity, not browser-level version readback, successful renderer readiness,
accepted profile adoption or feature delivery.

Final status again reported an empty connection list, but the corrected receipt
retains **`cleanup.ok=false`**. Close against the provisional connection was
rejected because it was absent, and its incomplete process/port identity
prevented an independent actual-exit witness from arming. Gateway stdio remained
held at that point. `processExited=true` did not establish normal application
Close or successful overall cleanup. Independent review rejected qualification;
no formal acceptance receipt was issued.

| Phase | Qualification attempts | Actual app creations | Formal / reverse cells | Screenshot calls / PNGs |
| --- | --- | --- | --- | --- |
| Original manifest | 1, failed | 0 | 0 / 0 | 0 / 0 |
| Corrected manifest | 1, failed | 1 | 0 / 0 | 0 / 0 |
| Cumulative | 2, both failed | 1 | 0 / 0 | 0 / 0 |

The additional qualification allowance was consumed and the formal-admission
gate was never satisfied. No formal matrix, reverse cell, screenshot request,
PNG, retry or channel change followed.

## Final separately authorized helper disposition

A second explicit human decision authorized termination of only the exact
identity-verified retained Node gateway and ended this experiment. That gateway
exited abnormally with code **-1**. Its probe and driver ended naturally with
exit **1** after stdio closed, and the orchestration session closed. No target
application or browser was terminated. Later checks found the old and new
owned helper/console processes, fixture application, profile-associated browser
and relevant listeners absent. The targeted default AppData locations and HKCU
application-registration keys were also absent.

These are authorized abnormal helper dispositions and point-in-time resource/
isolation observations. Both original raw failure receipts retain their false
cleanup results. Normal application Close and the adapter's independent
identity-bound actual-exit witness were not established, and the experiment
does not become a successful normal shutdown. No further qualification, formal
or reverse acquisition is authorized. Raw source/build/attempt evidence and
frozen launch inputs remain retained externally; documentation delivery and
worktree archival are separate from these runtime results.

## Helper verification and privacy

Before qualification, the focused fixture/probe/adapter tests passed **95/95**
and typecheck passed. At helper source `76d0bdb`, `pnpm verify:push` returned
exit **0** with **956/956 tests**, zero failures, cancellations or skips, and
all remaining gates passed. These regression/build checks establish helper
contracts and reproducibility; they do not accept either failed actual instance.

At `e0a7dbd`, both actual Git pre-push invocations ran the complete gate with
**956/956 tests** and all remaining checks passing. The first remote transfer
failed after the hook; a later transfer succeeded with the hook enabled again.
The corrected execution envelope independently bound **587 frozen inputs**,
all rechecked after its failed qualification. Their frozen bytes were retained
separately before this documentation update. These historical checks do not
claim a final push-gate result for later documentation changes.

Independent privacy review at `76d0bdb` inspected the seven-file helper/test
diff, all **118 tracked test files**, and the wider tracked text inventory.
It found no actionable disclosure of known personal identifiers, real user
paths, private addresses or checked credential signatures. Synthetic path
fixtures, loopback endpoints, public references and deliberately rejected inputs
were classified separately. The initial five follow-up documentation files were
also checked without a privacy finding. This is a current-text audit, not an
exhaustive history, binary-content or arbitrary-secret audit.

This public record omits personal paths, usernames/SIDs, actual PIDs/ports,
endpoint/session tokens, raw environment/stdio and receipt identifiers. Private
source/build/attempt evidence remains outside the repository. Static source,
dependency and PE identities are distinguished from unqualified runtime facts;
both failed cleanup verdicts and subsequent abnormal helper dispositions remain
part of the result.
