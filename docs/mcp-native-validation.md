# MCP native lifecycle delivery and validation

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
