# Fixed Tauri fixture screenshot validation

The minimal Windows Tauri fixture built successfully and passed source/build
review, but its sole candidate qualification attempt failed during native
permission inspection before the application was created. Qualification did
not pass. Actual counts are **one qualification attempt, zero application
creations, zero formal cells, zero reverse-order cells, zero screenshot
requests and zero PNGs**. Gateway cleanup remains unconfirmed; further
acquisition is blocked. There is no screenshot compatibility or feature-benefit
result.

This is a separate follow-up to the
[existing application experiment](application-screenshot-validation.md).
Readest remains excluded before acquisition, and the historical Obsidian matrix
and its cleanup observations remain unchanged.

## Fixed source and build

The externally built package is `dct-tauri-screenshot-fixture` **0.0.1**.
Direct dependencies pin Tauri **2.12.1** with default features disabled and
`wry`, `devtools`, `custom-protocol` enabled, tauri-build **2.7.1** with default
features disabled, and serde_json **1.0.145**. The actual lock resolves Wry
**0.57.0**, Tao **0.37.1**, and WebView2 COM/sys **0.39.1**. These are build
identities; no running Tauri/WebView2/Chromium version was measured.

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
`http://tauri.localhost/fixture.html`. That URL, native window and renderer
metadata remain unobserved at runtime.

Both arms use a verified copy of the same executable, empty host argv and a
fresh profile. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` supplies the controlled
port and loopback address. Baseline means **not explicitly enabled**, with no
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

## Qualification failure and retained cleanup

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
process exit remain unconfirmed. Read-only observations found no matching
fixture process or relevant listener at their observation time. Such absence
observations do not replace actual exit evidence or make cleanup complete.

No formal or reverse-order cell ran. There was no retry, channel change,
replacement candidate or screenshot replay. Further launches remain blocked
until cleanup certainty is established. The one-qualification allowance remains
exhausted; any new qualification requires explicit authorization even after
cleanup is resolved. Profile adoption, runtime versions,
browser argv/feature state, renderer/HWND identity, runtime isolation, normal
application Close and screenshot pixels remain unqualified. Source/build
acceptance cannot supply those missing observations, and no completed archive
or successful overall experiment shutdown is claimed.

## Helper verification and privacy

Before qualification, the focused fixture/probe/adapter tests passed **95/95**
and typecheck passed. At helper source `76d0bdb`, `pnpm verify:push` returned
exit **0** with **956/956 tests**, zero failures, cancellations or skips, and
all remaining gates passed. These regression/build checks establish helper
contracts and reproducibility; they do not accept this failed actual instance.

Independent privacy review at `76d0bdb` inspected the seven-file helper/test
diff, all **118 tracked test files**, and the wider tracked text inventory.
It found no actionable disclosure of known personal identifiers, real user
paths, private addresses or checked credential signatures. Synthetic path
fixtures, loopback endpoints, public references and deliberately rejected inputs
were classified separately. The five follow-up documentation files were also
checked without a privacy finding. This is a current-text audit, not an exhaustive
history, binary-content or arbitrary-secret audit.

This public record omits personal paths, usernames/SIDs, actual PIDs/ports,
endpoint/session tokens, raw environment/stdio and receipt identifiers. Private
source/build/attempt evidence remains outside the repository. Static source,
dependency and PE identities are distinguished from unobserved runtime facts;
cleanup uncertainty remains part of the result.
