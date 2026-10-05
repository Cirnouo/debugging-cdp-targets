# MCP native lifecycle delivery and validation

Current lifecycle follow-up: [ADR 0013](adr/0013-session-owned-exit-cleanup.md)
and [the lifecycle protocol](lifecycle-protocol.md) replace the earlier retained
dead-session recovery, target-close waiting and full-result Hook/status semantics.
The dated acceptance and gate results below are historical evidence; they do not
verify the later lifecycle changes.

Peer host follow-up, 2026-10-05: [ADR 0012](adr/0012-peer-host-distributions.md)
adds complete independent Codex and Claude Code distributions. Actual Windows
acceptance passed with Codex CLI 0.160.0 and Claude Code 2.1.283: local Marketplace
installation and 73-tool discovery, four Hook boundaries, one Stop continuation,
idle-next-turn delivery, lifecycle context and the full namespaced Claude Skill.
Hooks-disabled Claude and untrusted Codex negatives preserve MCP availability.
These host smokes use temporary configuration, loopback models and the production
gateway I/O fixture; [smoke commands](../tests/smoke/README.md) remain explicit.
The following record describes the earlier native-runtime delivery evidence.

Date: 2026-10-04, Windows, Node 24.21.0, pnpm 12.4.2.
Scope: unreleased 0.1.0, [ADR 0011](adr/0011-mcp-native-lifecycle.md).
The implementation changes the repository and generated delivery files only.
No installed plugin, user configuration, old test state, release, tag or PR is changed.

## Delivered behavior

| Original issue | Delivery | Evidence and limits |
| --- | --- | --- |
| 1. Output access denied | Explicit official `--workspace` through per-connection `mcpArgs`; negotiated roots forwarding retained; status explains directory source. | Option/workspace tests pass. A working directory is not file authorization; roots negotiation is not claimed when absent. |
| 2. Fixed official arguments/catalog | Safe per-connection options, full stable catalog, actual enabled tools and schemas, activation conditions and complete explicit recipes. | Independently regenerated 53 public-bin profiles match the 66-name catalog for 1.10.1. Variant/disabled-tool/independent-connection tests pass. Slim changes actual availability, not the initial gateway catalog. |
| 3. Elevated launch | Native manifest/AppCompat/native-740 classification, private environment transfer, separate permission/readiness phases, real process identity/handle and one-shot elevated close. | Ordinary real Node/GUI and successful elevated native/MCP runs pass. A normal gateway verified the high-privilege target, preserved Unicode environment, observed actual exit and normally closed it. Earlier native-1223 evidence separately verifies cancellation. |
| 4. Wrapper identity | Structured launch replaces Agent shell wrappers. The gateway observes the actual app PID/time/handle. Fixed platform support is never the target. | Ordinary native PID/argv/cwd/Unicode-env/exit tests pass. App stdio uses NUL with an explicit inherited-handle list; helper exit is observation loss, not app exit. |
| 5. Missing CDP listener | Verified app identity permits normal cleanup with an absent listener; foreign listeners are separately rejected. | Absent/foreign listener and retry tests pass. No unrelated listener owner is signalled. |
| 6. Incomplete close errors | Phase/native error/close-request/process-exit/listener evidence and retryable connection/session identity. | Refused close, cancelled elevated close, delayed exit and cleanup retry tests pass. Disconnect releases observation without claiming retained apps exited. |
| 7. Screenshot timeout/blocking | Phase timing, actual SDK timeout classification, connection quarantine, HTTP/CDP pending cleanup, normal upstream transport close and explicit recovery. | Controlled screenshot experiment localizes a minimized-browser delay to an unanswered CDP capture request. Historical Obsidian's first blockage is still unproven. See details below. |
| 8. Repeated native file dialogs | Skill handles the existing OS dialog by app identity, stops re-triggering after cancel, and distinguishes native dialogs from JavaScript dialogs. | Fresh skill scenario validation uses the corrected workflow. No new native-dialog automation tool is invented. |
| 9. Readest border/residual window | Normal GUI show state, independent native/CDP comparison and identity/geometry/exit capture. | Two preserved test copies close normally without residual windows. The historical transparent-border issue was not reproduced and is not claimed fixed. |
| 10. Obsidian multiline input | Excluded as requested. | No related change or new regression test. |
| 11. Wrong tool arguments | Skill examples follow actual official definitions, including `evaluate_script.function` and page routing variants. | Fresh skill validation and actual Codex lifecycle-schema capture pass. Arguments/results remain official after removing only `_dct`. |
| 12. Application warnings/resources | Attribution remains specific to observed application/upstream behavior. | No blanket security bypass, warning suppression or resource-error concealment. |

Plugin CLI source, its dedicated control IPC, CLI entry/build output, tests and
current operating instructions have been removed. Historical ADRs are explicitly
superseded rather than rewritten. Original official package CLI files remain
because the complete unchanged release is delivered.

The seven MCP tools provide discovery/status, start, restart, stop, end-task,
bounded operation wait and cancellation. Request identity deduplicates retries;
current entry/connection/session checks reject stale work. Operation events live
only in memory, replay by cursor, and arrive through Hooks at task boundaries.
No idle-chat wakeup, automatic restart, automatic tool replay or connection cap
is introduced.

## Screenshot diagnosis

The opt-in `tests/smoke/screenshot-layers.ts` experiment used an independent Chrome
profile and the unchanged delivered official public bin. It compared the same
newly launched test browser directly and through the CDP router:

| Window state | Direct official call | Routed official call |
| --- | --- | --- |
| Normal | 41.07 ms | 44.87 ms; CDP screenshot response 33.19 ms |
| Minimized | 57,707.13 ms, eventually completed | SDK timeout at 60 seconds; CDP screenshot remained unanswered for 60,008.27 ms until transport cleanup |

Initialization completed in roughly 0.6–0.7 seconds. Initial routed ownership
inspection completed independently before screenshot invocation. For this
reproduction, the slow interval lies between the browser's screenshot CDP request
and its response. A similarly long direct call means the gateway is not required
to trigger it. This is evidence about this Chrome experiment, not proof that the
historical Obsidian event had the same initial cause.

The pinned official handler does not consume cancellation while holding its
tool mutex. The gateway now isolates an unfinished cancelled/timed-out upstream,
clears its pending traffic, preserves target identity and reports
`CONNECTION_RECOVERY_REQUIRED`. Other connections remain independent. Unit and
real SDK tests cover cancellation, pending cleanup and peer availability; the
full native two-Chrome integration result is recorded in the final gate section.

The reproduction intentionally exits unsuccessfully when screenshot timeout is
captured; it is diagnostic evidence, not a passed screenshot test. No dependency
was patched/upgraded, timeout extended, foreground switch automated, or Agent
preflight checklist added. The remaining upstream action is to reproduce the
unanswered capture in Chromium/Puppeteer and integrate cancellation in the
official handler. Any dependency change requires separate reviewed evidence.

## Minimized screenshot follow-up, 2026-10-05

The following research and this branch's acceptance preparation are separate from
the historical Chrome experiment above. The earlier unexplained Obsidian failures
did not record native window state. They cannot retrospectively be assigned the
same cause as a later controlled minimized-window reproduction.

The 2026-10-05 research used an isolated Obsidian profile whose actual application
was 1.13.7, Electron 43.3.0 and Chromium 150.0.7871.212; the installed launcher was
1.13.6. With default arguments, official direct capture in a confirmed minimized
window timed out at 60,014.10 ms. Routed capture also timed out, quarantined only
its upstream and left a VS Code peer usable. Adding only
`--enable-features=CDPScreenshotNewSurface` gave a 29.24 ms direct minimized capture
and routed CDP screenshot intervals of 26.98 and 25.60 ms. Those routed complete
tool calls took 5,212 and 5,059 ms, including ownership verification. The same
native window remained minimized while a synthetic banner changed from yellow A
to green B; the second screenshot contained the update. These research results
are narrower than the complete screenshot-mode acceptance required below.

Chromium 150's [feature definition](https://raw.githubusercontent.com/chromium/chromium/150.0.7871.212/content/common/features.cc)
describes a new surface identity that avoids waiting for ForceRedraw. Its
[browser snapshot implementation](https://raw.githubusercontent.com/chromium/chromium/150.0.7871.212/content/browser/renderer_host/render_widget_host_impl.cc)
and [CDP screenshot handler](https://raw.githubusercontent.com/chromium/chromium/150.0.7871.212/content/browser/devtools/protocol/page_handler.cc)
support that mechanism as an inference from source and the controlled comparison;
no native thread stack or Chromium trace identified the exact blocked callback.
The feature is disabled by default in the reviewed
[Chromium 154.0.8037.98 definition](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/content/common/features.cc)
as well. Neither source establishes support in every Chromium embedder, or fresh
pixels for a completely hidden or fully occluded window.

The reviewed [Chromium command-line implementation](https://raw.githubusercontent.com/chromium/chromium/150.0.7871.212/base/command_line.cc)
can override duplicate switches and accepts equivalent spellings on Windows.
Its [feature-list implementation](https://raw.githubusercontent.com/chromium/chromium/150.0.7871.212/base/feature_list.cc)
registers disable overrides first, so an enable switch cannot override an explicit
disable. The conditional shared instructions therefore accept only one effective
canonical enable token before the first exact `--`, preserve other list entries
and parameters, and keep an already present bare target feature once. Duplicate
switches/features, decorated target entries, explicit disable conflicts, equivalent
spellings and separate-value forms are reported as ambiguous without rewriting
the user's choices. This is guidance for existing `launch.args`, with no new MCP
field or default injection. Changed argv requires completed normal Close followed
by a new start with a fresh requestId and newly returned connection/session.
No WebView2 environment contract, personal profile, user configuration or global
Skill is changed.

The research VS Code 1.140.0 used Chromium 150.0.7871.250. Foreground and unfocused
captures succeeded, but native minimization was denied with error 5 and
IsIconic=false. An unsupported Browser window command also could not establish
minimization. These cases provide no minimized VS Code A/B acceptance and do not
attribute its original failure to the Obsidian reproduction.

The current branch adds native identity/state/action evidence, same-HWND before
and after checks, SW_RESTORE, and bounded observation of an actual state change.
The Task 1 six-test focused set passed, including the disposable native fixture
and pure window-evidence regressions. The explicit launch, fixture confinement, fresh diagnostic,
decoded RGBA pixel and complete peer cleanup checks passed the independent
12-test focused set and typecheck. These are fixture/helper results, not real
application screenshot compatibility results.

The [opt-in smoke](../tests/smoke/README.md) requires normal A and minimized B/C
with fresh opaque updated pixels for viewport, fullPage and element screenshots.
fullPage also checks a patch below the viewport. Each capture validates the same
owned window's native state before and after, with a 5,000 ms state observation
bound. Candidate screenshot work must complete below 5,000 ms and a gateway call
below 20,000 ms. Normal A must complete every mode; only a confirmed minimized
baseline B/C timeout is diagnostic and requires a live gateway peer during the
pending call and after quarantine. A candidate timeout fails. Permission denial,
unsupported native controls, stale/ambiguous identity, and incomplete modes cannot
pass. All newly owned targets must normally Close, final gateway status must be
empty and gateway stdio must actually exit. Fully hidden/occluded windows remain
outside this matrix.

### VS Code measured matrix

The completed Windows comparison uses actual VS Code 1.140.0, Electron 43.7.3
and Chromium 150.0.7871.250 in newly launched administrator instances. Both
variants have independent synthetic profiles/workspaces and identical test-only
`window.titleBarStyle` and `window.controlsStyle` settings set to `custom`.
The application clicks its own minimize button; native observations establish
the resulting state. No AppCompat setting or personal profile is changed. The
only candidate argv difference is the bare Chromium screenshot feature.

The accepted four-cell matrix combines three valid cells from retained local
run `vscode-Fc0CSe` with the fresh gateway candidate in `vscode-Ho7I6H`:

| Route / variant | Valid coverage | Measured result |
| --- | --- | --- |
| Direct / baseline | Normal A all modes, minimized B all modes and C viewport/fullPage; eight PNGs | C/element SDK timeout at 60,008.69 ms. |
| Direct / candidate | A/B/C viewport, fullPage and element; nine PNGs | Complete calls 35.69–3,000.95 ms, all below 5,000 ms. |
| Packaged gateway / baseline | Normal A all modes, minimized B viewport/fullPage; five PNGs | B/element timeout at 65,811.07 ms including verification; isolated upstream and usable peer. |
| Packaged gateway / candidate | A/B/C viewport, fullPage and element; nine PNGs | Complete calls 5,696.11–9,278.45 ms; fresh CDP screenshot phases 49.80–2,011.97 ms. |

Every valid cell records a fresh application identity. Each attempted capture
confirms normal A or minimized B/C on the same native HWND before and after it. Independent
review decoded all 31 accepted PNGs and checked all 126 opaque phase-color pixels,
exact dimensions and fullPage patches below the viewport. A is yellow, B green
and C blue. Both candidates capture updated minimized content in every mode;
their direct calls or fresh CDP phases and gateway complete calls meet their
separate bounds. Each element capture selects from a fresh snapshot; the same
node can retain the same UID string across snapshots.

The gateway baseline timeout added an interrupted upstream-processing phase of
60,007.77 ms and an interrupted CDP screenshot phase of 59,387.01 ms. It returned
`CONNECTION_RECOVERY_REQUIRED` with reason `upstream-timeout` and closed/quarantined
only the affected upstream. The independent peer completed official reads in
11,294.11 ms while the baseline remained pending at both observation boundaries,
then in 10,857.01 ms after quarantine. Its connection/session/PID/port/native HWND
and creation time remained stable, status stayed connected and its window stayed
normal. The baseline window remained minimized; subsequent affected-route calls
received the explicit quarantine gate. This establishes observable isolation;
internal pending-map cleanup remains supported by router regressions.

The earlier `vscode-BI8Fqp` run was blocked by native error 5 and is excluded.
The original Fc0CSe gateway candidate completed only A/viewport, then failed its
normal-state guard before A/fullPage. Its failed native sample was not retained,
so that transition's cause is unknown. It is excluded, and Fc0CSe as an entire
run is not called passed. Ho7I6H supplies a new independent candidate using the
same maintained capture/window/pixel/cleanup logic and generated gateway.
All newly acquired instances, including the excluded candidate, normally closed
with actual exit. Each gateway ended with `connections: []` and stdio exit 0.

These results support conditional explicit launch guidance for the measured
VS Code environment. Raw records, profiles and synthetic PNGs remain local under
`.superpowers/sdd/minimized-screenshot-compatibility/acceptance/`; they are retained
review evidence rather than published repository artifacts. They do not establish
compatibility for other applications, hidden/occluded windows or the original
unobserved failures.

### Obsidian measured matrix

The completed fresh run `obsidian-GY23ZX` uses the installed executable's built-in
Obsidian 1.13.6, Electron 43.3.0 and Chromium 150.0.7871.212. Each cell has a new
synthetic vault and profile, with the same initialization files and updates
disabled for this comparison. The old updated 1.13.7 research profile is not
copied. The only candidate argv difference is the bare screenshot feature.

| Route / variant | Valid coverage | Measured result |
| --- | --- | --- |
| Direct / baseline | Normal A all modes; three PNGs | Minimized B/viewport SDK timeout at 60,014.70 ms. |
| Direct / candidate | A/B/C viewport, fullPage and element; nine PNGs | Complete calls 22.20–1,071.64 ms. |
| Packaged gateway / baseline | Normal A all modes; three PNGs | Minimized B/viewport timeout at 65,836.38 ms including verification. |
| Packaged gateway / candidate | A/B/C viewport, fullPage and element; nine PNGs | Complete calls 5,797.59–6,911.37 ms; fresh CDP screenshot phases 17.83–1,038.74 ms. |

Every attempted screenshot has same-HWND/owner/path/creation-time evidence before
and after it. Normal A remains non-iconic; B/C remain iconic, including the two
baseline timeouts. The 24 completed PNGs have exact measured viewport, fullPage
and element dimensions and current opaque yellow/green/blue pixels. Independent
review decoded all 24 PNGs and checked 96 phase-color sampling points. fullPage
also contains the current color below the viewport. Both candidates meet the
separate screenshot-stage and complete-call bounds. Preparation can explicitly
restore an initially minimized owned window before normal A; capture does not
focus or restore it.

The gateway baseline quarantines only its timed-out upstream while preserving
the application identity and minimized window. Its independent peer completes
official reads in 11,637.67 ms while baseline is pending at both observation
boundaries, and in 11,387.84 ms after quarantine. Peer identity and normal native
state remain stable; subsequent baseline calls receive the explicit quarantine
gate. All five newly acquired applications normally Close with actual exit;
each gateway finishes with `connections: []` and stdio exit 0. The smoke exits 0
with no failed or blocked cell, accepting baseline timeout as diagnosis.

The earlier `obsidian-SFcIdr` matrix failed strict size/preparation assertions
and is excluded. Two separate geometry probes established the fractional CSS
viewport and official fullPage rounding before correcting the smoke. They are
tooling evidence, not extra compatibility cells, and both normally closed.
Neither those trials nor this result attributes the unobserved historical
Obsidian failure to a specific native callback.

### Chrome measured matrix

The accepted Chrome matrix combines the valid direct cells from `chrome-lDkIqM`
with fresh gateway baseline `chrome-eZ87rQ` and candidate `chrome-4lVhH9`.
All newly owned browser endpoints report Chrome 154.0.8037.98; the renderer's
reduced user-agent reports Chrome/154.0.0.0. Each cell has an independent new
profile and the same synthetic data URL. Both variants use the same executable
and initialization contract; the candidate adds only the bare screenshot feature.

| Route / variant | Valid coverage | Measured result |
| --- | --- | --- |
| Direct / baseline | Normal A all modes; three PNGs | Minimized B/viewport SDK timeout at 60,002.90 ms. |
| Direct / candidate | A/B/C viewport, fullPage and element; nine PNGs | Complete calls 31.91–417.06 ms. |
| Packaged gateway / baseline | Normal A all modes; three PNGs | Minimized B/viewport timeout at 67,439.01 ms including verification. |
| Packaged gateway / candidate | A/B/C viewport, fullPage and element; nine PNGs | Complete calls 6,001.14–6,586.79 ms; fresh CDP screenshot phases 13.91–39.90 ms. |

The 24 accepted PNGs have exact measured dimensions and current opaque A/B/C
pixels, including fullPage patches below the viewport. Independent review decoded
all 24 PNGs and checked 96 sampling points. Every attempted capture
has stable native HWND/owner/executable/creation evidence before and after it:
normal A remains non-iconic, and B/C remain iconic. Both candidates meet their
screenshot-stage and complete-call bounds.

The fresh gateway baseline adds interrupted upstream-processing of 60,014.61 ms
and CDP screenshot work of 60,011.91 ms, then quarantines only that upstream.
The independent peer completes in 13,878.51 ms during baseline's pending interval
and 12,582.58 ms after quarantine, with stable identity, normal window and connected
status. The affected application remains minimized, and further calls receive
the explicit quarantine gate. The baseline and peer normally Close, with empty
final gateway connections and stdio exit 0; the fresh candidate does likewise.

The original gateway baseline is excluded: peer preparation found two visible
top-level windows, so no baseline screenshot was attempted. Its original gateway
candidate completed only normal A viewport/fullPage before the A/element native
normal-state guard failed, also before screenshot invocation. The failed native
samples were not retained, so their causes remain unknown. Both failed cells
normally closed. The two fresh cells use exactly the maintained smoke logic,
with only explicit route/variant selection and relative-path adjustments in
retained local runners. No failed request or old connection/session was replayed.
The original whole run is not called passed.

### Local gates and evidence limits

The local generated-payload gates used for these application comparisons
passed `pnpm typecheck`, `pnpm build:plugin`, `pnpm check:build`,
`pnpm check:security` and `pnpm verify:push`, all with exit 0. The full verification
reported 450/450 tests and coverage of 92.69% lines, 87.61% branches and 89.96%
functions. Both host payloads matched their maintained inputs and passed inventory
and byte-identity checks. The production runtime is byte-identical to the starting
main baseline; maintained and generated shared Skill changes remain together.
Normal push hooks verify the final branch, and delivery additionally requires the
exact PR head and actual merged-main push CI/CodeQL gates. Version 0.1.0 remains
Unreleased.

Raw records, synthetic profiles/PNGs, runner provenance, review results and gate
logs remain local under `.superpowers/sdd/minimized-screenshot-compatibility/`.
The final Close All ledger covers 27 newly acquired real-test applications:
11 direct targets have explicit actual-exit/upstream-close receipts, and 16
gateway targets have successful terminal normal Close results. All 11 gateway
entries finish with empty connections and stdio exit 0. A final independent
read-only native check finds all 27 recorded PIDs and exact identities absent,
with no listeners on test ports 20222 or 20223. This includes failed trials and
geometry probes; unrelated existing applications are not closed.
Failed/blocked trials remain explicitly excluded. These measured environments
support conditional explicit launch guidance; fully hidden/occluded windows,
other versions/applications and historical unobserved failures remain unverified.
Normal Close applies only to newly owned test targets; no force kill is used.

## Readest comparison

Readest 0.11.1 executable SHA-256:
`1d8c461ad7754dd457f5d5697fd4bd68f8f9217b3e2eaf8b7663c204827bb37d`.
The source executable and historical test directory were preserved. Two new
portable copies used independent settings/WebView profiles, without copying the
user's books or settings. One used normal native launch and the other added CDP
configuration.

Both main Tauri windows measured 1538 × 1172 and their resize/WebView children
1524 × 1164. Both also contained visible 14 × 14 auxiliary `readest-sic` and
`Tao Thread Event Target` windows. Both accepted normal close, actually exited,
and had no remaining recorded windows. Those auxiliary handles alone do not
establish the historical transparent-border defect or blame a launch option.

After the NUL/CreateProcess correction, the comparison was repeated with two
additional preserved copies. The ordinary copy's first sample still showed its
814 × 608 hidden startup window; the later 6.23-second sample showed the visible
1538 × 1172 main window. The CDP copy was visible at its 6.50-second first sample.
Settled geometry matched, both normally exited, and both final window lists were
empty. Sampling latency is not a measurement of the exact first paint.

## Native review corrections

An independent code review identified and then rechecked three corrected areas:

- Application streams could inherit helper protocol handles. Native CreateProcess
  now supplies only inherited NUL handles. Malformed protocol errors are fixed
  messages; late valid creation identity remains available for cleanup.
- Windows PowerShell's `Process.Path` requires MainModule access, which may fail
  for elevated targets. Snapshot now uses native limited-query path/time evidence.
  A controlled denial fixture verifies this path without a UAC prompt.
- A failed normal close could leave the observer alive after gateway EOF, and
  later confirmed exit could retain the profile reservation. Observation is now
  disposed on ownership relinquishment, retained for live retryable connections,
  and profile release requires confirmed exit.

Focused regressions were observed failing before each correction and passing
afterward. Permission success was subsequently verified with real authorization,
separately from the mocked protocol and denied-MainModule fixture.

## Successful elevated follow-up

The continued native smoke successfully launched the requireAdministrator GUI,
preserved the Unicode environment sentinel, verified its path/time/session from
the normal gateway, sent normal close and observed exit code 0 through the retained
application handle. Native close reported request sent, process exited and error 0.

The delivered gateway then passed the complete MCP start/wait/status/Close flow
from an explicitly verified non-elevated host. The disposable application's own
marker confirmed its administrator token and real PID. Its optional loopback
discovery endpoint exercised actual process/listener/browser-endpoint ownership
and readiness checks; it does not implement browser tools. The existing Chrome
smokes verify those tools separately.

Operation evidence placed permission waiting at 2,109 ms, CDP waiting at 5,296 ms
and successful startup at 8,677 ms. This shows the phase ordering; simulated-clock
regressions separately prove the readiness budget excludes authorization time.
Status included the actual official tools. Normal Close completed in 9,337 ms;
the final snapshot contained no app process or listener, the connection list was
empty, and the gateway exited 0. A new ordinary GUI discovery regression was first
observed failing without the fixture endpoint, then passing with it.

## Codex and supply-chain checks

The actual installed Codex app-server ran against isolated temporary homes and a
local model-response fixture. Five existing Hook cases passed: untrusted,
PreToolUse, PostToolUse, Stop continuation and idle-next-turn delivery. A sixth
lifecycle case captured the real outgoing model requests and verified structured
start fields, `mcpArgs`, operation wait and the terminal Hook result. SDK success
alone was not used as evidence that the model saw these declarations/events.

The normal official-browser smoke passed public-bin discovery, CSS/extensions,
native launch, normal close and restart. Its visible-console monitor collected
1,919 observations and saw no new helper console window. Native launch was later
hardened by the NUL-handle correction and revalidated by native GUI regressions.

Official chrome-devtools-mcp 1.10.1 and MCP SDK 2.2.0 remain pinned. Both locks and
release hash evidence are unchanged. Complete upstream files, original licenses,
vendor inventory and skills remain delivered; runtime starts only the verified
public bin. Generated plugin and standalone security-checker outputs are rebuilt
from maintained source. No package download or dependency upgrade is part of the
implementation. The repository supply-chain policy still defines the npm graph
audit scope and independent release-evidence gate.

## Final gates and local evidence

| Verification | Result |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm build:plugin` | Passed; generated native support and gateway rebuilt. |
| `pnpm check:build` | Passed; delivered runtime matches maintained source. |
| `pnpm build:security` and its read-only check | Passed; source-audit changes are reflected in the standalone checker. |
| `pnpm verify:push` | Passed after the elevated follow-up, including 246/246 tests, syntax, format/lint, coverage, repository, distribution and Git checks. |
| Coverage | 91.94% lines, 84.92% branches, 90.07% functions in the final reported aggregate. |
| Independent final review | No remaining findings after corrections; reviewer ran 58 focused tests. |
| Real multiple-Chrome recovery | Passed: three simultaneous targets, Keep/reuse, scoped Close, a fourth later target, process exit, same-port restart and stale-route rejection. Gateway exited normally. |
| Real upstream timeout isolation | Passed with two targets using different `mcpArgs`: unfinished official handler times out, pending CDP is interrupted, upstream closes, peer works during/after timeout, explicit restart recovers and both apps normally close. Total call interval including health/cleanup: 67,313.24 ms; the upstream timeout remains 60 seconds. |
| Readest after native launch correction | Passed normal-close/exit/window evidence for both new copies; historical border anomaly remains unproven. |
| Real elevated native launch and close | Passed authorization, Unicode environment, low-privilege identity verification, app-handle exit observation and normal close. |
| Real elevated MCP lifecycle | Passed delivered-gateway start/wait/status/Close, true administrator token/PID, owned loopback discovery readiness, actual official catalog and complete normal cleanup. |

The first migrated multi-Chrome smoke still expected an empty Stop Hook after
completed operations; its assertion was corrected to validate the new operation
notice and one-time delivery. The new timeout smoke initially expected a protocol
exception for an already quarantined connection; it now checks the intended MCP
error result and retained lost status. Both corrected smokes were rerun to exit 0;
neither correction changed production behavior.

Successful real elevation, handle transfer, environment, readiness and normal
close now have integration evidence. The remaining diagnostic limits are the historical first screenshot blockage and
Readest transparent border, which the controlled experiments do not establish.

Local untracked evidence is retained under
`.superpowers/sdd/mcp-native-lifecycle/`: catalog verification, actual Codex Hook
and lifecycle logs, native/screenshot/Readest metadata, review regression results,
and final verification logs. Test profiles and old test copies are retained;
ordinary cleanup closes only newly owned targets. Diagnostic records contain
identity, phase, error category and timing, never command arguments, environment
values, full tool calls or user page content. Screenshot artifacts contain only
the synthetic dedicated test page.

## CI follow-up on 2026-10-04

[CI run 37179957748](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37179957748)
passed supply-chain, Quality, Linux and macOS checks, but failed commit auditing
and two Windows native tests. The authorized title rewrite left the previous
commit unreachable in the fresh CI checkout. The commit checker attempted its
old-to-new range before validating any messages. A real transport-clone regression
now checks the entire new ancestry when a forced push's base is missing, rejects
an invalid ancestor, and refuses shallow history, a missing head or an ordinary
push with a missing base.

The two Windows failures reproduced locally by using an actual 8.3 temporary
directory. Native close compared a normalized requested path with an unnormalized
process path; .NET Framework expanded only the former to its long form. Identity
validation consequently refused normal close, and the still-running fixture kept
its temporary directory busy. Normalizing both paths fixes the comparison while
retaining PID, creation-time and session checks. The real short-path regression
also verifies that different executable paths and creation times cannot close
the fixture. All 20 focused commit/native tests passed after these corrections.
The original two failing Windows tests also passed with `TEMP`/`TMP` pointing
to the same 8.3 reproduction directory. `pnpm typecheck`, `pnpm build:plugin`,
`pnpm check:build` and the complete `pnpm verify:push` passed, including 250/250
tests without Windows skips and the generated-runtime/distribution audits.

## Screenshot acceptance CI follow-up on 2026-10-05

[PR CI run 37294117742](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37294117742)
exposed a window-evidence identity rejection under the Windows runner's 8.3
temporary path and a private Claude callback fixture's missing PID evidence.
[Latest-base CI run 37295307782](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37295307782)
independently repeated the window rejection. These failed runs are retained as
failures; neither a successful CodeQL run nor a local rerun replaces their result.

The window rejection reproduced with a newly owned asInvoker fixture launched
through an actual short alias. As with the earlier native-close correction,
.NET Framework expanded only the requested executable path before comparison.
The evidence helper now normalizes both paths under the same contract. It still
rejects a different executable, a creation time differing by one 100ns tick and
an incorrect HWND before any mutation. `actualExecutablePath` retains the raw
native query result; the compatible `executablePath` uses the caller's spelling
only after successful identity validation. Native TypeScript samples require
and preserve the raw field; legacy parsed fixtures remain compatible.

Controlled private-host startup delays reproduced the callback fixture failure
without changing the production helper. The test accepted a host startup
timeout as a callback timeout before a completed turn or transcript existed.
Callback modes now use the existing owned-child IPC readiness barrier and
require exactly one completed turn. Their 400ms helper deadline, 15000ms outer
watchdog and actual owned-child cleanup remain unchanged. The historical CI
log does not establish why host startup was delayed.

These corrections affect test fixtures and evidence collection. The delivered
runtime bytes, official release, dependency locks and accepted real-application
screenshot matrix above remain unchanged. The original three task commits are
preserved; the latest main was incorporated by a normal merge, with the CI
corrections added as a subsequent ordinary commit.

The corrected focused window/screenshot/configuration set passed 21/21 and
the complete Claude fixture file passed 25/25, both without skips. The complete
local `pnpm verify:push` passed 453/453 tests without skips, with 93.02% line,
87.83% branch and 90.08% function coverage. `pnpm typecheck`, `pnpm build:plugin`,
`pnpm check:build` and `pnpm check:security` also passed. These are local results;
delivery still requires successful checks on the final PR head and actual
main push after squash.

## Settled exit-Hook smoke follow-up on 2026-10-05

PR #9 merged as `b13665d6b005da66fecb51653e8d6eecea481307` after all eleven
required checks passed on its exact head. Its
[main push CI 37298653326](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/37298653326)
subsequently failed macOS Real Chrome at `entry-recovery.ts:224`: the first
Stop Hook read after a kept application's normal exit contained zero event
batches. The other seven CI jobs and all three CodeQL jobs succeeded. The
failed main run remains a failure; a follow-up PR corrects the test boundary.

Runtime status omits a retired connection immediately so old routes cannot
reach an exited application. Its exit notice remains pending until upstream
cleanup settles, and only then becomes eligible for Hook delivery. The smoke
incorrectly assumed that connection absence meant the notice was already
deliverable. A controlled deferred upstream-close fixture reproduced that
same observation: the route was absent, a peer remained usable and the Hook
was empty; releasing cleanup produced the correct exit notice exactly once.
The historical CI log does not identify the precise cleanup delay in that run.
The smoke's timing labels now identify the observed connection retirement;
that observation does not establish the instant upstream cleanup completed.
Its existing five-second timing assertion remains unchanged.

Both external-exit smoke cases now wait for the first nonempty Hook result
using their existing 15000ms / 100ms readiness polling budget. The first batch is retained
unchanged and passes the original event count, identity, cleanup and peer
assertions; a later empty read still proves single delivery. Malformed or wrong
nonempty evidence is not discarded while waiting for a different result.
Production retirement, cleanup and notification ordering remain unchanged.
No production timeout, packaged runtime, official release, lock or screenshot
compatibility result changes, and no local real application needs to reopen.

The initial one-shot helper failed five controlled regressions before the wait
was implemented. Two additional fake-clock deadline cases also failed before
their correction. Final focused Hook/runtime/target/configuration tests passed
60/60 without skips. The complete local `pnpm verify:push` passed 461/461 without
skips; typecheck, build:plugin, check:build and check:security passed as well.
The original five-second smoke timing assertion remains enforced under its
accurate name. Exact follow-up PR and main push checks remain the delivery gate.

## Resistant private-fixture startup follow-up on 2026-10-05

Reverification after normally merging main's documentation-only PR #10 failed
one of 461 local tests: the resistant private Claude fixture's PID file was
absent. Its driver had already accepted a timeout and exited successfully.
The saved failed run remains a failure. A controlled one-second delay before
PID evidence reproduced the same missing file without opening a user target.

The resistant experiment started its 300ms helper deadline before the owned
fixture had written its PID and installed its termination handler. It could
therefore accept startup timeout without establishing the intended resistance.
The historical local log does not identify the exact interpreter startup delay.
As with the input/callback fixtures, a real owned-child IPC readiness barrier
now precedes the timeout experiment. The resistant CLI's separate spawn entry
uses that same ready child while retaining the existing Windows refusal wrapper.
The fixture records TERM then KILL requests on that exact owned child and verifies
native close before timeout rejection and removal from the ownership set.
Windows simulates TERM refusal at the private I/O boundary; POSIX sends native
TERM to the ready handler. Both require the final native KILL and actual close.
The 300ms helper deadline, termination grace periods, 15000ms outer watchdog,
actual child close and PID-absence assertions remain unchanged. Production
helpers and accepted screenshot payloads do not change.

The retained delayed-startup regression failed before the readiness correction;
the complete Claude configuration file then passed 26/26 tests without skips.
Final local `pnpm verify:push` passed 462/462 tests without skips, with 92.97%
line, 87.78% branch and 90.12% function coverage. Typecheck, repository, commit,
read-only build and distribution checks all passed in that command. The prior
failed verification is retained separately; exact updated PR-head checks and
the actual merge SHA's main push CI/CodeQL remain required for delivery.
