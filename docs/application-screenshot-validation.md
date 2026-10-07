# Existing application screenshot validation

The selected Obsidian instance passed qualification, but none of its twelve
formal cells completed screenshot acceptance. Readest was excluded before
startup because the selected source could change user protocol configuration.
Every acquired resource exited normally. These results establish no accepted
feature-benefit comparison.

A separate [fixed Tauri fixture follow-up](tauri-screenshot-validation.md)
records an external source/build review and a failed qualification attempt.
Readest's exclusion and every historical Obsidian observation below remain
unchanged.

This Windows experiment compares baseline and explicitly requested
`CDPScreenshotNewSurface` behavior on a newly owned existing application renderer.
It qualifies a known source/version-specific contract, rather than detecting
universal application capabilities. Observed feature argument delivery is not a
query of Chromium's internal FeatureList, and screenshot success alone does not
establish correct pixels or sufficient native condition evidence.

## Sources and scope

Qualification and the first formal baseline foreground viewport cell used runner
`4df7755dfcfb185a47378ce82c7e3fb94e5ef118`; all remaining formal cells use
`0ca9c184628b06aaa82fb668da40854e74486222`, integrated on base
`f68517c7382fbaa619fcdb1005bea477c6ad6b7a`. The repair confines screenshot output
to the existing fresh fixture/workspace. It does not widen `--workspace`, replay
earlier cells or reset experiment counters. Both arms use the same sealed Codex
payload from source `eef90b4d974600c3a6697d40dc76e99037466315`. Complete extracted
inventory, lengths, hashes and digest are checked before acquisition; archive
SHA256 is provenance, not an independently repeated archive check.

The selected source identities are:

| Artifact | SHA256 |
| --- | --- |
| Obsidian executable | `1f1cbb107d5603385c4a1552f8885a4739ecb17f85d8dd621c3e1d9742b49a48` |
| Obsidian `resources/app.asar` | `676dfa53cd09118ec03bb1f04868082db0564eea05e53d0ca5307beac305a710` |
| Obsidian `resources/obsidian.asar` | `d769003f81435abe53576172f3bb0695132880cc7b7970f2f0086f7d5ea968b5` |
| Readest executable | `1d8c461ad7754dd457f5d5697fd4bd68f8f9217b3e2eaf8b7663c204827bb37d` |

These results apply only to the selected binaries, measured runtime versions and
reviewed Windows route. No product runtime/public schema, application preset,
generic feature injection, official Server, dependency, lock or dist change is
part of this test tooling work.

## Readest: blocked before acquisition

[Readest v0.11.1 Cargo.lock](https://github.com/readest/readest/blob/v0.11.1/Cargo.lock#L6974-L6992)
resolves `tauri-plugin-deep-link` to `2.4.7`; the fixed
[workspace patches](https://github.com/readest/readest/blob/v0.11.1/Cargo.toml#L37-L40)
do not replace it. The
[Windows startup path](https://github.com/readest/readest/blob/v0.11.1/apps/readest-app/src-tauri/src/lib.rs#L262-L265)
unconditionally calls `register_all()` before main-window creation, using the
[configured desktop scheme](https://github.com/readest/readest/blob/v0.11.1/apps/readest-app/src-tauri/tauri.conf.json#L160-L167).
The matching official
[deep-link-v2.4.7 package](https://github.com/tauri-apps/plugins-workspace/blob/deep-link-v2.4.7/plugins/deep-link/Cargo.toml#L1-L3)
and [registration implementation](https://github.com/tauri-apps/plugins-workspace/blob/deep-link-v2.4.7/plugins/deep-link/src/lib.rs#L221-L257)
show direct Windows writes under `HKCU\Software\Classes\readest`, including
protocol/icon/open-command values derived from the current executable, without
an existing-handler check.

A fresh portable copy cannot confine those native writes to its synthetic
settings/WebView profile. The preserve-user-configuration requirement therefore
blocks this source: **zero qualification acquisitions, formal cells, screenshot
requests and PNGs**. No registry repair/restoration, permission-failure workaround,
alternative source, user, sandbox or hook was used. No unexecuted recipe is
presented as a supported workaround.

PE metadata `0.2.2` and historical release `0.11.1` are distinct static values.
Running app/Tauri/WebView2/Chromium versions, consumed argv/environment, main
renderer URL/title, native HWND, screenshot behavior and effective feature state
remain unknown. No packaged URL or JavaScript window-label layout is assumed.
Historical observations remain historical; the block establishes this experiment's
scope boundary, not screenshot compatibility or incompatibility.

## Obsidian qualification: passed

The sole qualification acquisition passed with **zero screenshots**. Actual
runtime readback reported Obsidian **1.13.6**, Electron **43.3.0** and Chromium
**150.0.7871.212**. Identity-bound evidence confirmed the new profile and synthetic
vault, unique existing main renderer and owned main HWND, ordinary token level,
actual browser/profile/port/feature argv delivery, loopback listener and browser
endpoint. The source-backed main URL `app://obsidian.md/index.html` was qualified
against the fresh vault identity rather than substituted with a new page.

Before acquisition, the reviewed read-only guard verified the fixed source/ASAR
and external-fixture identities, no existing Obsidian process, and the already
matching protocol association. Both fixed HKCU keys required `KEY_ALL_ACCESS`
opens and raw `REG_SZ` queries with complete ordinal command equality; HKLM
scheme/UserChoice overrides had to be absent. The actual Windows x64 ordinary
context/parent/environment and sealed helper elevation checks were required.

Future executable spelling and ordinary launcher inheritance remain the reviewed
`pinned-source-and-documented-ordinary-loader-inference`, consistent with the
[CreateProcessW contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw).
The preflight records `futureFileExeObserved=false`; it does not claim observation
of a future operand. The sealed token helper's internal CloseHandle return is
unobserved. Surfaced errors, guard-owned disposal, guard exit and matching exclusive
stdout/receipt remain required. Permission waiting/handshake/ERROR740 blocks and
cancels an attempt without runas authorization or replay.

Qualification cleanup confirmed normal Close, actual app/browser exit, no owned
listener, empty gateway connections and gateway exit code zero. Qualification
proves this acquired route and argument consumption, not an internal FeatureList
query or a completed screenshot comparison.

## Complete formal results

Each cell acquires a fresh app/gateway/profile/vault and requests one screenshot.
Baseline means **not explicitly enabled**, without asserting the runtime default
makes the feature inactive. Candidate adds only the reviewed bare feature literal.
Background throttling and other default application behavior remain unchanged.
Actual counts are **one qualification, twelve formal cells and twelve screenshot
requests**. Nine PNGs were saved: four viewport and five full-page. Two baseline
minimized calls timed out/quarantined, and the first baseline foreground viewport
call returned the workspace-access tool error. Every actual cleanup was confirmed,
including related anchors; final orchestration exited with code zero.

| Cell | Runner | Primary capture / PNG acceptance | Complete native samples inside pending interval | Cleanup |
| --- | --- | --- | --- | --- |
| Baseline foreground normal, viewport | `4df7755` | Workspace access denied; no PNG | `2` | Confirmed |
| Candidate foreground normal, viewport | `0ca9c18` | Capture succeeded; strict width check failed: `1282 != 1283`; height `1003 == 1003` | `1` | Confirmed |
| Baseline minimized, viewport | `0ca9c18` | Timeout/quarantine; no PNG | `16` | Confirmed |
| Candidate minimized, viewport | `0ca9c18` | Capture succeeded; strict width check failed: `1282 != 1283` | `1` | Confirmed |
| Baseline background normal, viewport | `0ca9c18` | Capture succeeded and PNG saved; strict width check failed: `1282 != 1283`; outcome evidence-insufficient with native-during and PNG failures | `0` | Confirmed, including owned anchor Close/exit |
| Candidate background normal, viewport | `0ca9c18` | Capture succeeded and PNG saved; evidence-insufficient/strict width failure: `1282 != 1283` | `1` | Confirmed |
| Baseline foreground normal, full page | `0ca9c18` | Capture succeeded; evidence-insufficient/strict width failure: `1281 != 1283` | `1` | Confirmed |
| Candidate foreground normal, full page | `0ca9c18` | Capture succeeded; evidence-insufficient/strict width failure: `1281 != 1283` | `1` | Confirmed |
| Baseline background normal, full page | `0ca9c18` | Capture succeeded; evidence-insufficient/strict width failure: `1281 != 1283` | `1` | Confirmed |
| Candidate background normal, full page | `0ca9c18` | Capture succeeded; evidence-insufficient/strict width failure: `1281 != 1283` | `1` | Confirmed |
| Baseline minimized, full page | `0ca9c18` | Timeout/quarantine; no PNG | `21` | Confirmed |
| Candidate minimized, full page | `0ca9c18` | Capture succeeded; evidence-insufficient/strict width failure: `1281 != 1283` | `2` | Confirmed |

All nine saved PNGs were independently rehashed. The four viewport files are
`1282 × 1003`, 22776 bytes, SHA256
`76969ea81a4fcdff8ca6c534f2df3b6bb71f6c5d34148e4c399f90799a021f59`.
The five full-page files are `1281 × 2005`, 45402 bytes, SHA256
`887c2468387fb0330cabc96dfc9ce509ce15edc55b1a410f8b6ed86073704c5a`.
All nine fail the immutable runner's strict expected width of `1283`.
The foreground candidate decoder observed four opaque green samples; decoder
observations are separate from strict pixel acceptance because width failed
before color assertions could accept the PNG. No durations, unreported pixel
checks or live fractional geometry are inferred.

Minimized baseline timeouts and candidate saved captures are observed transport
outcomes, but the candidate PNGs were not accepted. There is **no accepted A/B
screenshot compatibility or feature-benefit claim** from this matrix. The
background baseline viewport cell additionally has zero fully pending native
samples. All original errors, failed receipts and counters remain recorded.

The primary cap is **12 cells per qualified app**, or 24 for both apps.
Qualification is separately limited to one acquisition per app. A reverse-order
contrast may add at most **two fresh cells per qualified app**, four beyond the
primary cap, only if both minimized viewport cells satisfy their capture/condition
eligibility criteria and have different outcomes. Independent review of the
minimized viewport pair ruled out a reverse contrast because candidate PNG
acceptance failed. No reverse contrast was acquired. Readest remains at zero
throughout. The remaining formal matrix used immutable `0ca9c18`; geometry repair
does not reset acquisition/capture counters or authorize replacement cells.

## Geometry acquisition defect and separate tool repair

Read-only source comparison confirmed a precision contract missing from the new
application tool. The existing
[layer experiment](../tests/smoke/screenshot-layers.ts) measures an invisible fixed
`100vw` by `100vh` element's fractional DOMRect. The application marker in
`0ca9c18` derives geometry from integer `innerWidth`/`innerHeight` instead.
The existing [geometry regression](../tests/screenshot-fixture.test.ts) pins
`1025.5999755859375 × 802.4000244140625` at DPR `1.25`, yielding exactly
`1282 × 1003`, which matches the observed viewport PNG dimensions.

That synthetic fractional example establishes the omitted precision contract,
not the unmeasured actual fractional viewport or root DOMRect of these instances.
The recorded dimension failures are therefore partly associated with a confirmed
geometry-acquisition defect; their actual strict failures remain unchanged.
Decoder-green observations do not retroactively satisfy the dimension/color
acceptance sequence. The unchanged full-page dimension contract converts
fractional content width `1025.5999755859375` at DPR `1.25` to physical width
`1282`, then through the float32 reciprocal and floored CSS clip to physical
width `1281`. This synthetic calculation does not establish the unmeasured actual
fractional root values of these instances.

After all twelve primary cells closed with confirmed cleanup and orchestration
exit zero, the separate maintained repair `51a51bb` restored both fractional
viewport DOMRect and actual root DOMRect measurements. Eight new fake-DOM
regressions execute the actual marker JavaScript at the injected official-call
boundary, with independently specified physical PNG dimensions. They cover both
arms and modes, probe removal on success and error, exact one-pixel rejection,
and rejection of a wrong below-viewport pixel. Independent spec and quality
review found no actionable issue.

The bounded real matrix was not rerun with this repair. Old receipts remain
failed, without replacement geometry, cap resets, reshoots or reverse contrasts.
Strict PNG assertions and the existing Chrome probe remain unchanged.

## Capture and cleanup criteria

The runner installs opaque yellow content, establishes the native condition,
updates fresh green/nonce content and reads back geometry before the one official
`take_screenshot`. Foreground requires the owned target HWND; minimized requires
its native minimized state. Background normal uses a related owned opaque anchor,
verified foreground handoff and geometric containment. This is an anchor-placement
condition, **not proof of full compositor occlusion**. No focus/restore/selection
or target mutation occurs during capture.

At least one fully validated native sample must start and complete inside the
local MCP dispatched-to-settled pending interval. Before/during/after samples
must retain the same owned process/HWND/path/creation identity and required state.
These timings are not internal CDP timings. A too-fast successful PNG with zero
complete samples is retained as insufficient condition evidence, without delay,
reshoot or replay.

Accepted PNGs require decoding, exact expected dimensions, SHA256 and four opaque
green checks for viewport; full-page capture requires **five** checks, including
the additional below-viewport point. Capture error, timeout/quarantine, native
condition loss, post-observation failure, dimension/pixel failure and insufficient
interval evidence remain distinct. The primary receipt is retained before any
post-observation failure. Existing deadlines remain unchanged.

Cleanup attempts every owned target/anchor and retains separate Close/exit-witness
failures. Close receipts or empty connections alone cannot prove app exit:
identity-bound native actual-exit evidence, no owned listener, empty gateway,
actual stdio exit and finalized evidence writes are required. Any uncertainty
retains gateway/identities and halts all subsequent acquisition. No app is
force-killed or automatically restarted. Private fixtures/receipts/PNGs stay
outside the repository; no PNG is committed.

## Tooling and verification

The [fixture helper](../tests/smoke/application-screenshot-fixture.ts) validates
complete pairs, confined synthetic files, explicit source/copy hashes and safe
debugging/environment carriers before preparation. The
[CLI](../tests/smoke/application-screenshot-probe.ts),
[core](../tests/smoke/application-screenshot-core.ts),
[adapter](../tests/smoke/application-screenshot-adapter.ts) and
[native boundary](../tests/smoke/application-screenshot-native.ts) reuse existing
MCP, capture-observer, anchor, PNG and lifecycle helpers. See the
[smoke index](../tests/smoke/README.md) for the external config contract and
fictional command examples. Matrix ordering/caps and preflight approval belong
to the reviewed caller.

[Fixture](../tests/application-screenshot-fixture.test.ts),
[probe](../tests/application-screenshot-probe.test.ts) and
[adapter](../tests/application-screenshot-adapter.test.ts) regressions cover fake
inventory refusal, ambiguous/missing identity, actual data-path binding,
privileges/permission cancellation, qualification without capture, one-shot formal
capture, condition/pixel failures, primary-result retention and cleanup failures.
These contracts do not substitute for actual application results.

On `0ca9c18`, focused **79 tests** and typecheck passed. The complete
`pnpm verify:push` passed **926/926**, zero skipped, with all gates passing and
coverage **93.85% lines, 89.30% branches, 91.17% functions**. The prior
**924/922/two-failure** foreground/focus-condition result remains retained.
Focused native regressions passed **15/15**; the later full pass does not erase
the earlier failure or attribute it to the separately recorded earlier user click.
This gate certifies `0ca9c18`. For the separate `51a51bb` geometry repair, the
eight new tests first produced seven failures and one pass, then eight passes.
The full related fixture/probe/adapter/shared-geometry selection passed
**97/97**, zero skipped. Typecheck, scoped Biome, script syntax and text/diff
checks passed. Final branch push verification and remote CI are recorded in the
PR. Neither regression tests nor CI retroactively accept the old actual cells.

The first main Windows CI after integration retained **933/934 passes, one
failure, zero skipped**: the parse/C# compile-only regression reached its own
ten-second child-process cutoff with empty stdout/stderr. That receipt cannot
locate the slow stage or establish an environment cause. The separate test repair
uses a finite **30-second compiler deadline inside a 45-second test budget** and
fixed read/parse/compile/argv stage diagnostics. It preserves the parsing,
compilation and exact synthetic-argv assertions, without a retry or application
inspection. Subprocess diagnostics omit raw commands, paths, environment and source.
The original CI failure remains retained. These test budgets are separate from
the unchanged 60-second gateway and 90-second client screenshot deadlines, and
the formal application matrix remains closed.

## Privacy audit and publication limits

The baseline `654746327ddab435a304c079515ba6eb66e500ea` audit covered **146 tracked
files**: 109 tests and 37 tooling files. It found one actual-host disclosure in
two smoke README executable examples. The reviewed fix replaces them with
explicitly fictional paths/local executable selection. Current text is corrected;
Git history is not erased. Upstream notices and historical records are preserved.

Independent privacy review at `0ca9c18` was clean across **155 tracked files**,
118 tests and 37 tooling files. That task diff spans 11 paths, including nine added
files. Static literal/credential-format scans distinguish synthetic examples,
generic platform/loopback fixtures, version strings and license attribution;
they do not prove absence of every credential form or runtime redaction.

The baseline audit excluded other branches/worktrees/PRs, untracked fixtures,
ignored evidence, inherited runtime environments and existing app/user data. It
ran no app/test/build and read no raw experiment receipts. This public record
uses redacted result facts and fixed source references. It omits personal
paths/usernames/SIDs, actual process IDs/ports, endpoint/session tokens, raw
environment/stdio and receipt identifiers. Raw evidence and PNGs are retained
outside the repository. Runtime/source-specific
limits and cleanup uncertainty remain part of the result, rather than generalized
application support claims.
