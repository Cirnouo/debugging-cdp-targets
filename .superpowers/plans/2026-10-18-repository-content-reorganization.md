# Complete repository content reorganization

Status: accepted direction and implementation scope, 2026-10-18. This plan
describes the target and incremental delivery. It does not describe every target
path as already present. The current maps in [source](../../src/README.md),
[tests](../../tests/README.md), [tooling](../../tooling/README.md) and
[documentation](../../docs/README.md) remain authoritative for delivered placement
until their owning batch updates them. PR #55 is the first delivered slice.

## Scope and completion axes

Reorganize source, central tests, tooling and documentation by actual purpose,
including their contents, exported names, real callers and failure contracts.
Do not merely sort unchanged files into new folders. Use direct domain roots
under `src/`, technical boundaries inside a domain where useful, central
`tests/` grouped by observable contract, and tooling grouped by its operation.
Use the existing native erasable TypeScript, Node and pnpm toolchain.

This plan accompanies [ADR 0017](../../docs/adr/0017-singleton-desktop-app.md)
and the [singleton plan](2026-10-17-singleton-app-plan.md); it does not replace
their resource, authorization, protocol, isolation or delivery requirements.
The accepted App is GUI-only. No plugin CLI, TUI, daemon, autostart, deep link,
new framework, workspace, barrel, forwarding wrapper or persisted runtime state
is introduced by this reorganization. Keep 0.1.0 Unreleased.

Structural completion and singleton feature/native acceptance are separate.
Pending deployment source must integrate against the actual delivered Host,
GUI and protocol changes. A source-only native component, static build or older
experiment cannot establish current App, installer, host UI or platform
acceptance. Preserve all dated failures and unknown cells.

## Classification rules and corrected content owners

Choose an owner from actual content and consumers before choosing a path.
Shared means a proven shared value rule; it is not a home for uncertain
responsibility. Keep one authority for each mutable fact, resource lifetime
and transaction. Do not impose identical layers or one file per function.

| Content | Target responsibility and required change |
| --- | --- |
| Gateway Core | Composition, registry and retained cleanup ledger, immutable start admission, managed connection and read-only projection have distinct purposes. Replace misleading plugin/entry names at real callers. A connection retains generation pointers, active execution and original client facilities together. |
| Target lifecycle | Pure launch/isolation/CDP/profile rules take evidence as input; actual acquisition, rollback, normal Close and exit observation remain I/O transactions. Connection directory leases survive intermediate restart exits and all pending native/resource users. |
| Gateway diagnostics | Give `Diagnostic` and `Diagnose` to existing pure `gateway/lifecycle-contract.ts`; move only clock-backed `measured` to `gateway/diagnostics.ts`. Preserve the once-only finisher, phases, outcomes and timing and update every real runtime/type consumer. Pure rules must not import the timing owner, including through erased syntax. |
| Portable payload paths | Extract only `isOfficialRelativePath` to shared `payload-path.ts` as `isPortablePayloadRelativePath`. Its actual App, deployment and Plugin-build consumers share portable component syntax, not Official provenance. Rewire callers without an old alias; retain the exact accepted language. |
| Environment key matching | Move the shared Windows/POSIX key-selection value rule to `shared/environment-key.ts`. Target expansion and immutable environment capture retain their own owners. Do not create a general environment utility. |
| Official options and launch | Move deterministic boolean/URL/flag composition to existing `gateway/official/options.ts` as `buildOfficialServerArguments` with explicit inputs. Keep `process.env` snapshot and verified executable resolution in `server-launch.ts`. Preserve capture timing, ordering, Windows case semantics and restart snapshots. |
| Official execution and catalog | Separate reviewed fixed definitions from one actual-generation catalog publisher. Keep wire execution, original facilities and real child disposal coherent. Standard progress does not replace lifecycle operations/status/wait. Fixed outward catalog compatibility remains. |
| MCP dispatch | Keep exact loopback admission and explicit bearer ownership. Extract stateless owned-argument parsing; dispatch retains the modern holder, signed continuation, active response and exactly one Core invocation. Strip all `_dct`, preserve original official arguments/results and never replay. |
| Desktop | Main, sandboxed preload, renderer and validated contracts are real trust boundaries. Keep one App lifecycle/startup/configuration/shutdown join, distinct configuration schema/store, singleton admission and activation. A UI session owns polling/pending/error state; settings owns its draft. No restyle is required. |
| Host management | Keep desktop cached selection/native-job barrier distinct from the source/update/URL/receipt/checkpoint synchronization transaction. Separate byte-map proof from tree reads and the complete atomic endpoint write/readback transaction. Concrete Codex/Claude commands, intent, Git source and receipts have their actual owners. |
| Deployment and platform | Keep one physical installation operation/use/deletion transaction and one uncertain-successor/receipt coverage bridge. Separate read-only parent observation from target normal Close. Narrow shared I/O needs actual consumers; platform never becomes a business registry. Preserve original native companions and packaging adjacency. |
| Production fixture diagnostics | Keep the default-disabled diagnostics channel, safe subscription and real producers in platform. It is production observation support consumed by acceptance, not test-only fixture code. Preserve privacy/noninterference assertions. |
| Shared values | Errors, strict version predicates, portable payload syntax and environment-key matching have proven consumers. State exact pure dependency allowances, including the reviewed SemVer import; do not claim that every shared rule has no dependencies. |

## Central test content and naming

Preserve every original assertion, dynamic matrix, adversarial fixture,
precondition and cleanup effect. Split suites by observable failure contract;
cross-file integration is not itself a reason to split. Literal independent
expectations must not be replaced with the implementation's own generated data.

- Gateway registration, operation, lifecycle, client availability and lifecycle
    contract suites belong directly under `tests/gateway/`, corresponding to
    their real owners. Use `lifecycle`, `client-availability` and
    `lifecycle-contract` names rather than historical MCP/control-layer names.
- Host tests use `host-policy`, `synchronize`, `user-intent` and `git-source`.
    Official tests distinguish `reviewed-catalog`, `execution` and `options`.
    Remove retired entry/disconnect wording where the actual behavior is Core
    reuse or explicit cleanup; preserve historical evidence text.
- Split current `official-package.test.ts` into runtime `package-files`, tooling
    security `official-inputs` and quality `temporary-directory-alias`. Preserve
    the alias suite's real subprocess, environment, timeout and cleanup. Reconcile
    both the exact post-split child files and alias-specific name pattern against
    actual current registrations, so every intended case executes. Preserve
    selection semantics rather than stale literal alternatives; never select
    the alias suite itself or recreate retired cases to satisfy an old pattern.
- The first Host proof slice transfers two pure cases and six filesystem cases
    to `payload-integrity` and intermediate `payload-filesystem`. O7 later maps
    each filesystem assertion to `payload-files` or `endpoint-write`; late
    Claude lease and readback fences remain with the whole write transaction.
    Do not replay the old eight-case mixed suite or silently drop assertions.
- Keep readiness/diagnostic noninterference integration, including proof that
    optional sampling cannot block Close. Helpers do not require replacing this
    with isolated sampler mocks. Distinguish regressions of acceptance support,
    controlled fixture inputs, opt-in scenarios and adjacent scenario helpers.
- Keep the four interactive files/eighteen cases and explicit GUI opt-in before
    acquisition. Default and coverage select exactly the same safe suite set
    once, with concurrency 1 and existing floors. Update actual package scripts,
    policy, child argv, module URLs, README and fixture paths atomically. No
    recursive test glob may acquire acceptance or omit a moved regression.

## Tooling responsibility cuts

| Family | Content and boundary |
| --- | --- |
| distribution | Pure Host descriptors and supplied-value metadata/PNG/inventory rules; strict regular-file tree operation; thin payload builder; independent complete audit. Builders stop depending on an invoked auditor for reusable policy. Independent expected inventories and two-way Skill equality remain. |
| licenses | One actual bundled-notices collector shared by App and fixture builders. Canonical license identity, reviewed SDK map/vendor inputs and graph collection remain distinct. Remove unused assembly facades; preserve six license and six payload test bodies and real build input provenance. |
| app-delivery | Actual bundle graph, deterministic expected composition, verified archive extraction, complete flat staging and whole fresh-install publication/cleanup are meaningful owners. Preserve source-only/native adoption limits; do not split a transaction into generic services. |
| acceptance | Fixture builder and independently derived verifier remain separate. Keep literal thirteen-leaf/source identity proof independent of builder output. Runner's GUI guard precedes file selection. No new receipt framework. |
| official-server | Reviewed release loader, deliberate live catalog evidence operation and explicit installed/stage smoke have different purposes. Reviewed JSON is input, not a normal build cache. Rewire runtime fallback, builder definitions and explicit fixture input unions without reacquisition or hash refresh. |
| governance | Pure commit grammar, raw commitlint execution, event/ref construction, topology/history inspection and footer rule retain separate actual contracts. Keep full-message raw stdin and topology-proven merge behavior. |
| submissions | Shared Markdown scanner, supplied-value PR/Issue validation, one recoverable feedback transaction, fixed-origin REST and invoked credential/event loading. Preserve literal provenance, stale/live checks, pagination and owned-comment rules. No live remote feedback is needed to verify relocation. |
| releases | Extract deterministic release notes from the whole tag/remote/draft/resume/publication transaction. Preserve release identity and authorization. Do not make it share an incompatible submission parser. |
| quality | Shared pure text policy; complete AST role validator including type-only/computed/reexport/owned-child proof; syntax parser/runner; actual repository traversal. Keep independent evidence and exact new-domain pure guards; no validator plugin framework. |
| security | Pure lock/report/review/install policy and installed-graph validation versus descriptor-backed fingerprints, pnpm runner, scan lifetime and gate. The pure `Fingerprints` shape belongs with vulnerability reviews; the effectful hasher imports it. Keep one config/store/workspace and initial/review/final evidence transaction. |
| reviewed inputs | Original native/archive/release/catalog/vendor JSON are reviewed evidence, not generated dist. Migrate every explicit input, rooted reader and fingerprint together. Close missing reviewed-data fingerprint coverage without refreshing review identities. Generated standalone security output remains dependency-free, build-produced and independently compared. |

Retire obsolete thin-host `dist/` formatting exemptions in B4: current thin
inventory rejects that layout. Convert old synthetic positive-layout hook
cases into retired-path refusal assertions, recording the deliberate semantic
replacement. Retain original package mutation/missing/extra/link verification
under actual App/Official verifiers and preserve staged YAML/partial-staging
checks. This does not authorize shrinking security fingerprints of unexpected
tracked runtime content or adding an inferred App-stage text exemption.

## Documentation content, authority and tense

| Owner | Content and required reconciliation |
| --- | --- |
| user-guide | Current installation, applicability, configuration, workflow, privacy and troubleshooting. Retain actionable examples and useful concise dated support limits. Move detailed old CLI/Hook/cache/Desktop/Chrome/Close/screenshot methods and matrices to their existing evidence owners. Correct App repair versus Plugin reinstall and Claude's connection to an already running HTTP App. |
| architecture | Current internal Gateway/native resource, desktop, Host sync and deployment explanation. Extract internal checkpoint/receipt/port/retry content from the old Host record and management sections. Keep module-only deployment versus actual composition clear. |
| reference | Exact MCP lifecycle/HTTP/request-facility contracts; one current adopted Host metadata contract; sole domain glossary. Glossary defines concepts and links procedures, rather than duplicating commit-scope rules or directory-selection workflow. |
| Host reference | Consumer, supported interface, defaults/precedence/path base, adopted field or omission/reason and current limit. Reconcile the old Hook/stdio matrix against actual thin HTTP packaging; never copy it as the current contract. |
| Host evidence | One primary dated research/source and CLI/Desktop/Skill/MCP acceptance record. Preserve versions, failures, unsupported fields and unknown presentation. Internal synchronization implementation belongs in architecture; current adopted fields link this evidence rather than duplicating its inventory. |
| native evidence | Keep four complete dated MCP/application/Tauri records. Current window qualification, PID/handle, WM_CLOSE/job/resource and observation-failure explanation belongs in Gateway architecture; the old Tauri record retains the 2026-10-12 tested method. Date retired Hook/end-task/quarantine behavior and link current contracts. Never rename historical executed commands into claims about the future layout. |
| quality | Normal formatting/YAML/toolchain/typecheck/default verification and GUI opt-in requirements. Keep enough common guidance inline; link detailed CI operation and dated acceptance instead of retaining hidden duplicate histories. |
| git-environment | Complete long-path, per-worktree generated-hook and SSH initialization, including overrides, preservation, order and failures. Supply-chain remains the prerequisite installation owner. Root/CONTRIBUTING retain direct before-use timing. |
| continuous-integration | Actual jobs/checks/permissions/diagnostics/studies/CodeQL/Ruleset, latest-Node lane command order, schedules and monitoring. Extract these across quality and supply-chain headings; do not maintain two copies of workflow cadence. Add a before-changing-CI/check-contract trigger. |
| supply-chain and releases | Each remains a cohesive complete trust or publication lifecycle. Move only duplicated CI operation details. Preserve review-before-install, independent unchanged release evidence and separately authorized publication; correct old Plugin-runtime delivery prose to App. |
| ADR and plans | Numbered decisions/supersession and dated implementation scope remain distinct from current supported behavior. Preserve historical facts and private evidence limits. Plans do not establish executed acceptance. |

The root bilingual README remains first-use, without new research matrices,
translation or restyle. Installed instructions retain complete common gates and
directly reachable conditional references. Move instruction obligations only
with a semantic mapping of preconditions, prohibitions, authorization, defaults,
order and exceptions plus a canonical owner and explicit before-use trigger.
Links alone are not preservation proof; static scenario review is not an
executed Agent read trace. Rebuild generated peers from maintained inputs.

## Mutable authorities preserved through every batch

One owner must retain each of: registration authorization/expiry; operation
deduplication/owner/terminal results; registry route retirement and retained
cleanup ledger; connection generations/execution/original facilities; generation
resources; directory users/release barriers; target actual exit/normal Close;
official wire execution/child exit; actual catalog publication; modern request
continuation; App startup/configuration/shutdown; desktop Host job barrier;
Host synchronization checkpoints; physical installation leases; restart handoff
coverage. Read-only projections do not create mutable mirrors.

Before extracting mutable owners, trace late roots after cancel/Quit; partial
acquisition and late actual app creation; scoped restart and old callbacks;
detached official execution and original facilities; root exit with descendants;
late construction/catalog cleanup; Host update success followed by URL/receipt
failure; App config/native-job/Quit overlap; uncertain restart successor/ACK.
Show enrollment before the first await, definitive barriers and retained retry
ownership. Never infer actual target exit from a helper or transport ending.

## Delivery batches and status

Each batch uses the actual green delivered base and a recorded exact scope.
Combine independent cuts only while the complete diff remains reviewable; split
at a green dependency boundary when needed. Batch names are work breakdowns,
not a requirement for one PR per row or permission to skip content work.

| Batch | Status and coherent delivery |
| --- | --- |
| O0 | Scope and final content ledger established; this maintained plan records the corrected whole target. |
| O1 / PR #55 | Delivered: pure commit grammar versus actual message validation, pure text policy, three central tooling suites, five plans/two planning maps and precise historical-link repair. Main `2aa8e244` and its required CI passed. This does not complete source or remaining tooling/docs. |
| O2 | First source delivery: pure Gateway owned-argument parser, then Host payload proof, at real callers/tests with exact role guards and actual maps. Keep mutable transactions in place. These cuts do not depend on unrelated pending native source. |
| O3 / B2 | Actual bundled-notices owner and license/payload suite split; use a released producer base and preserve canonical inputs. |
| O4 | Gateway pure/target/native rules and shared payload/environment key corrections. Coordinate actual callers, role guards, helper adjacency, source inputs and central target/platform suites. |
| O5 | Core composition, registry/cleanup, admission, managed connection/projection and observable lifecycle test content. Complete mutable-owner walkthroughs first. |
| O6 | Official options/environment, package evidence, actual catalog/upstream and MCP request content; split mixed Official input/runtime/TEMP tests and preserve actual child argv. |
| O7 | Host native clients/intent/Git/payload read-write/receipt/synchronization and tests, including the intermediate filesystem successor map. |
| O8 | Desktop validated contracts, configuration/schema/store, singleton/activation/storage, preload/window and corresponding tests. |
| O9 | Desktop lifecycle/management/Host barrier/renderer session and panels, retaining clocks/privacy/desired-effective state and cleanup gates. |
| O10 | Integrated deployment physical store, authority/support/restart/parent observation structure, original native companions, all build/CodeQL/fingerprint/input consumers. |
| O11 | Incremental documentation responsibility delivery, including accepted Host split, reference glossary, guide evidence cut and full quality/Git/CI procedures. Update actual instructions/maps/links atomically; do not advertise future placement as delivered. |
| O12 | Final all-content/assertion/obligation reconciliation, retired-root removal, source/test/tooling/doc maps and complete verification on delivered main. |
| B1 | Governance event/history, submission/feedback and release-notes/publication content owners, including their real command/workflow consumers. No live remote publication or feedback. |
| B3 | Distribution reusable supplied-value policy and strict tree versus builder/independent auditor. |
| B4 | AST roles/syntax/repository/staged text responsibilities and explicit retired exemption correction. |
| B5 | Security pure contracts versus installed evidence/fingerprint/scan/gate; retain one trust transaction. |
| B6 | App bundling/composition/archive/staging/fresh contributor transaction after producer release. |
| B7 | Acceptance fixture build, independent verifier and explicit interactive runner paths. |
| B8 | Remaining reviewed-data/canonical-license placement and complete independent fingerprint/input coverage. |
| F1–F7 | Separate pending feature source: physical state/leases; module restart; immutable payload snapshot; exact parent watch; native writer authority; flat-stage producer; fresh contributor transaction/current docs. Integrate newer main effects; source-only is not native adoption or default cutover. |

The interim O4 diagnostic cut keeps the actual pure contract at
`src/domains/control-contract.ts`, including `Diagnostic` and `Diagnose`, while
only clock-backed `measured` moves to `src/gateway/diagnostics.ts`. The final
`gateway/lifecycle-contract.ts` and complete symbol/caller migration above remain
pending until the actual App UI and CDP domain consumers move coherently. This
interim placement does not complete O4 or the whole Gateway target.

## Per-batch workflow and complete-task gates

Use an independent managed worktree, test-first meaningful regressions, focused
verification and independent scope/quality review. Keep atomic normal commits.
Retain actual generated pre-push results; do not equate a manual run with a hook.
Read current submission policy/template, attach each PR, use normal exact-head
squash with a curated complete validated message, verify stored tree/message and
actual main CI, then FF clean primary main. Preserve necessary ignored evidence
precisely before managed archival; keep the PR attached to this chat.

For every move/split/merge account for real exports/imports, type-only/computed
roles, every assertion/fixture, both safe selectors, child invocations, rooted
URLs, build/seal/license/security/CodeQL inputs, generated outputs and applicable
instructions/maps/links. Do not refresh release hashes, vulnerability identities
or native evidence to silence a structural verification failure.

Completion requires all current and then-integrated content to have one truthful
owner; zero omitted/duplicate original assertions or obligations; no old-name
forwarders, empty layers or hidden remaining batches; matching exact safe file
sets; unchanged original upstream/native inputs; correct current versus dated
documentation; preserved single mutable authorities; focused and required full
checks on the actual final revision; and actual CI on delivered main. Report
native/host/UI unknowns separately. Do not declare the whole task complete when
an incremental PR passes.

## Complete target file inventory

The following lists the complete proposed leaves for these four content families
and maintained planning, including conditional deployment additions. It is an
implementation inventory, not a claim that every file already exists. Directory
maps are updated with actual delivery, and local AGENTS exist only for meaningful
recurring boundaries. Existing packaging, generated thin payloads, root contributor
entries and GitHub configuration keep their own current owners; update their real
consumers when a batch changes a referenced path or contract. New discoveries
within this scope refine the plan before implementation rather than being ignored
because a filename was absent from this snapshot.

### Source leaves

```text
src/AGENTS.md
src/README.md
src/deployment/AGENTS.md
src/deployment/README.md
src/deployment/delivery-files.ts
src/deployment/installation-store.ts
src/deployment/model/AGENTS.md
src/deployment/model/README.md
src/deployment/model/distribution.ts
src/deployment/model/installation.ts
src/deployment/model/release-inputs.ts
src/deployment/model/restart-handoff.ts
src/deployment/native-authority.ts
src/deployment/native-loader.ts
src/deployment/native/README.md
src/deployment/native/macos-deployment-authority.jxa
src/deployment/native/windows/README.md
src/deployment/native/windows/authority.cs
src/deployment/native/windows/create.cs
src/deployment/native/windows/protocol.ts
src/deployment/native/windows/stream.ts
src/deployment/native/windows/support.ts
src/deployment/official-runtime.ts
src/deployment/restart/README.md
src/deployment/restart/bridge.ts
src/desktop/AGENTS.md
src/desktop/README.md
src/desktop/configuration/README.md
src/desktop/configuration/data-directory.ts
src/desktop/configuration/model.ts
src/desktop/configuration/store.ts
src/desktop/contracts/AGENTS.md
src/desktop/contracts/README.md
src/desktop/contracts/commands.ts
src/desktop/contracts/snapshots.ts
src/desktop/instance/README.md
src/desktop/instance/activation.ts
src/desktop/instance/chromium-storage.ts
src/desktop/instance/singleton.ts
src/desktop/main/README.md
src/desktop/main/asset-policy.ts
src/desktop/main/bootstrap.ts
src/desktop/main/host-session.ts
src/desktop/main/lifecycle.ts
src/desktop/main/main.ts
src/desktop/main/management-evidence.ts
src/desktop/main/management-window.ts
src/desktop/main/management.ts
src/desktop/main/startup.ts
src/desktop/preload/README.md
src/desktop/preload/management-bridge.ts
src/desktop/renderer/README.md
src/desktop/renderer/app.css
src/desktop/renderer/app.html
src/desktop/renderer/connections.ts
src/desktop/renderer/controls.ts
src/desktop/renderer/elapsed.ts
src/desktop/renderer/host-plugins.ts
src/desktop/renderer/main.ts
src/desktop/renderer/management-app.ts
src/desktop/renderer/management-session.ts
src/desktop/renderer/operations.ts
src/desktop/renderer/registrations.ts
src/desktop/renderer/settings.ts
src/gateway/AGENTS.md
src/gateway/README.md
src/gateway/client-availability.ts
src/gateway/client-context.ts
src/gateway/connections/README.md
src/gateway/connections/cdp-router.ts
src/gateway/connections/connection-view.ts
src/gateway/connections/directory-lease.ts
src/gateway/connections/managed-connection.ts
src/gateway/connections/resource-owner.ts
src/gateway/connections/start-admission.ts
src/gateway/connections/workspace-policy.ts
src/gateway/core.ts
src/gateway/diagnostics.ts
src/gateway/lifecycle-contract.ts
src/gateway/lifecycle.ts
src/gateway/mcp/README.md
src/gateway/mcp/http-policy.ts
src/gateway/mcp/http-server.ts
src/gateway/mcp/lifecycle-tools.ts
src/gateway/mcp/request-dispatch.ts
src/gateway/official/README.md
src/gateway/official/actual-catalog.ts
src/gateway/official/catalog-input.ts
src/gateway/official/execution.ts
src/gateway/official/options.ts
src/gateway/official/package-files.ts
src/gateway/official/release-evidence.ts
src/gateway/official/reviewed-catalog.ts
src/gateway/official/server-launch.ts
src/gateway/official/upstream-connection.ts
src/gateway/operations.ts
src/gateway/owned-tool-arguments.ts
src/gateway/registrations.ts
src/gateway/registry.ts
src/gateway/request-failure.ts
src/gateway/targets/README.md
src/gateway/targets/chrome-profile-lease.ts
src/gateway/targets/data-directories.ts
src/gateway/targets/model/AGENTS.md
src/gateway/targets/model/README.md
src/gateway/targets/model/cdp-identity.ts
src/gateway/targets/model/chrome-profile-argument.ts
src/gateway/targets/model/chromium-features.ts
src/gateway/targets/model/isolation.ts
src/gateway/targets/model/launch-command.ts
src/gateway/targets/model/target-policy.ts
src/gateway/targets/port-reservations.ts
src/gateway/targets/target-host.ts
src/gateway/targets/target-lifecycle.ts
src/host-plugins/AGENTS.md
src/host-plugins/README.md
src/host-plugins/catalog-source.ts
src/host-plugins/endpoint-write.ts
src/host-plugins/git-source.ts
src/host-plugins/host-policy.ts
src/host-plugins/native/README.md
src/host-plugins/native/claude.ts
src/host-plugins/native/codex.ts
src/host-plugins/native/command.ts
src/host-plugins/native/user-intent-file.ts
src/host-plugins/payload-files.ts
src/host-plugins/payload-integrity.ts
src/host-plugins/receipts/README.md
src/host-plugins/receipts/contract.ts
src/host-plugins/receipts/payload.ts
src/host-plugins/receipts/store.ts
src/host-plugins/synchronize.ts
src/host-plugins/user-intent.ts
src/platform/AGENTS.md
src/platform/README.md
src/platform/fixture-diagnostics.ts
src/platform/native/README.md
src/platform/native/advisory-lock.ts
src/platform/native/macos-parent-identity.jxa
src/platform/native/parent-exit.ts
src/platform/native/parent-watch.ts
src/platform/native/process.ts
src/platform/native/windows-cdp-helper.ps1
src/platform/native/windows-launch.ts
src/platform/native/windows-native-helper.ps1
src/platform/native/windows-native-process.cs
src/platform/native/windows-parent-watch.ps1
src/platform/regular-file-evidence.ts
src/shared/AGENTS.md
src/shared/README.md
src/shared/environment-key.ts
src/shared/errors.ts
src/shared/payload-path.ts
src/shared/software-version.ts
```

### Central test leaves

```text
tests/AGENTS.md
tests/README.md
tests/acceptance-support/README.md
tests/acceptance-support/chrome/README.md
tests/acceptance-support/chrome/chrome-profile-probe.test.ts
tests/acceptance-support/chrome/chrome-smoke-config.test.ts
tests/acceptance-support/chrome/chrome-startup.test.ts
tests/acceptance-support/chrome/linux-startup-wait.test.ts
tests/acceptance-support/chrome/official-startup-study.test.ts
tests/acceptance-support/collectors/README.md
tests/acceptance-support/collectors/fixture-artifacts.test.ts
tests/acceptance-support/collectors/fixture-cost.test.ts
tests/acceptance-support/collectors/fixture-wait.test.ts
tests/acceptance-support/gateway/README.md
tests/acceptance-support/gateway/http-fixture.test.ts
tests/acceptance-support/hosts/README.md
tests/acceptance-support/hosts/claude-smoke-config.test.ts
tests/acceptance-support/hosts/codex-smoke-context.test.ts
tests/acceptance-support/hosts/instructions-smoke-evidence.test.ts
tests/acceptance-support/native-fixtures/README.md
tests/acceptance-support/native-fixtures/native-resource-diagnostics.test.ts
tests/acceptance-support/native-fixtures/native-resource-ready.test.ts
tests/acceptance-support/native-fixtures/owned-native-fixtures.test.ts
tests/acceptance-support/native-fixtures/sealed-study.test.ts
tests/acceptance-support/screenshots/README.md
tests/acceptance-support/screenshots/application-screenshot-adapter.test.ts
tests/acceptance-support/screenshots/application-screenshot-fixture.test.ts
tests/acceptance-support/screenshots/application-screenshot-probe.test.ts
tests/acceptance-support/screenshots/screenshot-background-anchor.test.ts
tests/acceptance-support/screenshots/screenshot-capture-observer.test.ts
tests/acceptance-support/screenshots/screenshot-fixture.test.ts
tests/acceptance-support/screenshots/screenshot-timeout-probe.test.ts
tests/acceptance-support/screenshots/window-evidence.test.ts
tests/acceptance/README.md
tests/acceptance/chrome/README.md
tests/acceptance/chrome/chrome-host.ts
tests/acceptance/chrome/chrome-profile-probe.ts
tests/acceptance/chrome/chrome-startup.ts
tests/acceptance/chrome/connection-recovery.ts
tests/acceptance/chrome/linux-startup-wait.ts
tests/acceptance/chrome/official-server.ts
tests/acceptance/chrome/retained-official.ts
tests/acceptance/hosts/README.md
tests/acceptance/hosts/claude-host.ts
tests/acceptance/hosts/claude-instructions.ts
tests/acceptance/hosts/claude-marketplace.ts
tests/acceptance/hosts/claude-process.ts
tests/acceptance/hosts/codex-host.ts
tests/acceptance/hosts/codex-instructions.ts
tests/acceptance/hosts/marketplace.ts
tests/acceptance/hosts/native-host-management.ts
tests/acceptance/native/README.md
tests/acceptance/native/windows-elevated-mcp.ts
tests/acceptance/native/windows-elevation.ts
tests/acceptance/native/windows-monitor.ps1
tests/acceptance/screenshots/README.md
tests/acceptance/screenshots/application-screenshot-adapter.ts
tests/acceptance/screenshots/application-screenshot-core.ts
tests/acceptance/screenshots/application-screenshot-fixture.ts
tests/acceptance/screenshots/application-screenshot-native.ts
tests/acceptance/screenshots/application-screenshot-probe.ts
tests/acceptance/screenshots/readest-native.ts
tests/acceptance/screenshots/screenshot-background-anchor.ts
tests/acceptance/screenshots/screenshot-capture-observer.ts
tests/acceptance/screenshots/screenshot-fixture.ts
tests/acceptance/screenshots/screenshot-layers-study.ts
tests/acceptance/screenshots/screenshot-layers.ts
tests/acceptance/screenshots/screenshot-timeout-fixture.ts
tests/acceptance/screenshots/screenshot-timeout-probe.ts
tests/acceptance/screenshots/screenshot-timeout-study.ts
tests/acceptance/screenshots/timeout-isolation.ts
tests/acceptance/screenshots/window-evidence.ts
tests/acceptance/screenshots/windows-application-evidence.ps1
tests/acceptance/screenshots/windows-png-evidence.ps1
tests/acceptance/screenshots/windows-selected-tab-evidence.ps1
tests/acceptance/screenshots/windows-window-evidence.ps1
tests/acceptance/support/README.md
tests/acceptance/support/app-http-metadata.ts
tests/acceptance/support/fixture-artifacts.ts
tests/acceptance/support/fixture-ci.ts
tests/acceptance/support/fixture-preload.ts
tests/acceptance/support/gui-authorization.ts
tests/acceptance/support/instructions-evidence.ts
tests/acceptance/support/lifecycle-client.ts
tests/acceptance/support/mcp-clients.ts
tests/acceptance/support/sealed-study.ts
tests/deployment/README.md
tests/deployment/delivery/README.md
tests/deployment/delivery/app-delivery.test.ts
tests/deployment/delivery/app-distribution.test.ts
tests/deployment/delivery/app-native-inputs.test.ts
tests/deployment/delivery/app-release.test.ts
tests/deployment/delivery/payload-integrity.test.ts
tests/deployment/installation/README.md
tests/deployment/installation/leases.test.ts
tests/deployment/installation/protected-copy.test.ts
tests/deployment/installation/state-store.test.ts
tests/deployment/installation/state-transitions.test.ts
tests/deployment/native/README.md
tests/deployment/native/authority.test.ts
tests/deployment/native/capabilities.test.ts
tests/deployment/native/source-boundaries.test.ts
tests/deployment/native/windows-protocol.test.ts
tests/deployment/native/windows-stream.test.ts
tests/deployment/native/windows-support.test.ts
tests/deployment/restart/README.md
tests/deployment/restart/handoff-records.test.ts
tests/deployment/restart/lease-handoff.test.ts
tests/deployment/restart/parent-exit.test.ts
tests/deployment/restart/parent-watch.test.ts
tests/desktop/README.md
tests/desktop/configuration/README.md
tests/desktop/configuration/app-configuration-storage.test.ts
tests/desktop/configuration/app-configuration.test.ts
tests/desktop/configuration/app-storage.test.ts
tests/desktop/contracts/README.md
tests/desktop/contracts/commands.test.ts
tests/desktop/contracts/snapshots.test.ts
tests/desktop/instance/README.md
tests/desktop/instance/app-activation.test.ts
tests/desktop/instance/app-chromium-storage.test.ts
tests/desktop/instance/app-singleton.test.ts
tests/desktop/main/README.md
tests/desktop/main/app-bootstrap.test.ts
tests/desktop/main/app-host-management.test.ts
tests/desktop/main/app-main-lifecycle.test.ts
tests/desktop/main/app-management.test.ts
tests/desktop/main/app-window-boundary.test.ts
tests/desktop/main/asset-policy.test.ts
tests/desktop/renderer/README.md
tests/desktop/renderer/app-manager-rendering.test.ts
tests/desktop/renderer/elapsed.test.ts
tests/fixtures/README.md
tests/fixtures/deployment/README.md
tests/fixtures/deployment/app-archive.ts
tests/fixtures/deployment/app-stage.ts
tests/fixtures/deployment/deployment-lock.ts
tests/fixtures/deployment/deployment-state-reader.ts
tests/fixtures/deployment/deployment-support.ts
tests/fixtures/gateway/README.md
tests/fixtures/gateway/core-runtime.ts
tests/fixtures/gateway/fake-cdp-target.ts
tests/fixtures/gateway/http-gateway.ts
tests/fixtures/gateway/native-close-runtime.ts
tests/fixtures/gateway/official-child.ts
tests/fixtures/native/README.md
tests/fixtures/native/compile-native-window.ps1
tests/fixtures/native/native-child.ts
tests/fixtures/native/native-resource-boundary.ps1
tests/fixtures/native/native-resource-child.ts
tests/fixtures/native/native-resource-cleanup.ts
tests/fixtures/native/native-resource-handoff.ps1
tests/fixtures/native/native-resource-identity.ps1
tests/fixtures/native/native-resource-log.ts
tests/fixtures/native/native-resource-ready-preload.ts
tests/fixtures/native/native-resource-ready.ts
tests/fixtures/native/native-resource-witness.ps1
tests/fixtures/native/native-resource-witness.ts
tests/fixtures/native/native-window.cs
tests/fixtures/native/normal-close-boundary.cs
tests/fixtures/native/normal-close-boundary.ps1
tests/fixtures/native/normal-close-window.cs
tests/fixtures/native/normal-close-window.ps1
tests/fixtures/native/owned-native-fixtures.ts
tests/fixtures/native/snapshot-limited-access.ps1
tests/fixtures/native/target-exit-reference.ts
tests/fixtures/native/windows-close-denial.ps1
tests/fixtures/submissions/README.md
tests/fixtures/submissions/current-pr-body.md
tests/fixtures/submissions/issue-feedback-http.ts
tests/fixtures/submissions/unwrapped-squash-message.json
tests/fixtures/submissions/wrapped-body-label-squash.json
tests/gateway/README.md
tests/gateway/client-availability.test.ts
tests/gateway/connections/README.md
tests/gateway/connections/cdp-router.test.ts
tests/gateway/connections/cleanup.test.ts
tests/gateway/connections/connection-options.test.ts
tests/gateway/connections/construction-cleanup.test.ts
tests/gateway/connections/directory-lifetime.test.ts
tests/gateway/connections/directory-operation-evidence.test.ts
tests/gateway/connections/execution-detachment.test.ts
tests/gateway/connections/gateway-cleanup.test.ts
tests/gateway/connections/gateway-exit-protocol.test.ts
tests/gateway/connections/independent-routing.test.ts
tests/gateway/connections/native-close-ownership.test.ts
tests/gateway/connections/registration-administration.test.ts
tests/gateway/connections/roots-admission.test.ts
tests/gateway/connections/router-quarantine.test.ts
tests/gateway/connections/scoped-restart.test.ts
tests/gateway/connections/target-events.test.ts
tests/gateway/lifecycle-contract.test.ts
tests/gateway/lifecycle.test.ts
tests/gateway/mcp/README.md
tests/gateway/mcp/lifecycle-protocol.test.ts
tests/gateway/mcp/mcp-http-modern.test.ts
tests/gateway/mcp/mcp-http-policy.test.ts
tests/gateway/mcp/mcp-http-server.test.ts
tests/gateway/mcp/originating-facilities.test.ts
tests/gateway/mcp/registration-lifecycle-schemas.test.ts
tests/gateway/official/README.md
tests/gateway/official/catalog-construction-cleanup.test.ts
tests/gateway/official/catalog-pagination-output.test.ts
tests/gateway/official/execution-accounting.test.ts
tests/gateway/official/execution.test.ts
tests/gateway/official/official-catalog-refresh.test.ts
tests/gateway/official/official-child-lifecycle.test.ts
tests/gateway/official/options.test.ts
tests/gateway/official/package-files.test.ts
tests/gateway/official/reviewed-catalog.test.ts
tests/gateway/official/server-arguments-environment.test.ts
tests/gateway/official/server-arguments.test.ts
tests/gateway/official/upstream-health.test.ts
tests/gateway/official/upstream-protocol.test.ts
tests/gateway/operations.test.ts
tests/gateway/owned-tool-arguments.test.ts
tests/gateway/registrations.test.ts
tests/gateway/targets/README.md
tests/gateway/targets/chrome-profile.test.ts
tests/gateway/targets/chromium-features.test.ts
tests/gateway/targets/close-and-attachment.test.ts
tests/gateway/targets/close-diagnostics.test.ts
tests/gateway/targets/controller-rollback.test.ts
tests/gateway/targets/data-directory-claims.test.ts
tests/gateway/targets/data-directory.test.ts
tests/gateway/targets/data-isolation.test.ts
tests/gateway/targets/directory-admission.test.ts
tests/gateway/targets/observer-cleanup.test.ts
tests/gateway/targets/port-and-endpoint-admission.test.ts
tests/gateway/targets/port-reservation.test.ts
tests/gateway/targets/startup-rollback.test.ts
tests/gateway/targets/structured-launch.test.ts
tests/gateway/targets/target-lifecycle.test.ts
tests/gateway/targets/target-ownership.test.ts
tests/gateway/targets/target-recovery.test.ts
tests/gateway/targets/target-spawn.test.ts
tests/host-plugins/README.md
tests/host-plugins/command-boundary.test.ts
tests/host-plugins/endpoint-write.test.ts
tests/host-plugins/git-source.test.ts
tests/host-plugins/host-policy.test.ts
tests/host-plugins/native-claude.test.ts
tests/host-plugins/native-codex.test.ts
tests/host-plugins/payload-files.test.ts
tests/host-plugins/payload-integrity.test.ts
tests/host-plugins/receipt-contract.test.ts
tests/host-plugins/receipt-persistence.test.ts
tests/host-plugins/synchronize.test.ts
tests/host-plugins/user-intent.test.ts
tests/interactive/README.md
tests/interactive/screenshot-background-anchor.test.ts
tests/interactive/window-evidence.test.ts
tests/interactive/windows-native.test.ts
tests/interactive/windows-normal-close.test.ts
tests/platform/README.md
tests/platform/fixture-boundaries.test.ts
tests/platform/fixture-diagnostics.test.ts
tests/platform/platform-close.test.ts
tests/platform/platform-evidence.test.ts
tests/platform/readiness-evidence.test.ts
tests/platform/regular-file-evidence.test.ts
tests/platform/target-exit-reference.test.ts
tests/platform/windows-launch.test.ts
tests/platform/windows-native.test.ts
tests/platform/windows-normal-close.test.ts
tests/shared/README.md
tests/shared/software-version.test.ts
tests/tooling/README.md
tests/tooling/acceptance/README.md
tests/tooling/acceptance/gui-authorization.test.ts
tests/tooling/acceptance/native-fixture-build.test.ts
tests/tooling/acceptance/native-fixture-verification.test.ts
tests/tooling/app-delivery/README.md
tests/tooling/app-delivery/app-bundles.test.ts
tests/tooling/app-delivery/app-stage.test.ts
tests/tooling/app-delivery/archive-extraction.test.ts
tests/tooling/app-delivery/fresh-installation.test.ts
tests/tooling/app-delivery/payload-composition.test.ts
tests/tooling/distribution/README.md
tests/tooling/distribution/host-distribution.test.ts
tests/tooling/distribution/host-metadata.test.ts
tests/tooling/distribution/icon-packaging.test.ts
tests/tooling/distribution/physical-payloads.test.ts
tests/tooling/distribution/plugin-distribution.test.ts
tests/tooling/distribution/skill-presentation.test.ts
tests/tooling/distribution/skill-questions.test.ts
tests/tooling/distribution/thin-plugin-metadata.test.ts
tests/tooling/distribution/thin-plugin-payloads.test.ts
tests/tooling/distribution/version-agreement.test.ts
tests/tooling/governance/README.md
tests/tooling/governance/commit-events.test.ts
tests/tooling/governance/commit-grammar.test.ts
tests/tooling/governance/commit-history.test.ts
tests/tooling/governance/commit-validation.test.ts
tests/tooling/licenses/README.md
tests/tooling/licenses/bundled-notices.test.ts
tests/tooling/official-server/README.md
tests/tooling/official-server/catalog-source.test.ts
tests/tooling/quality/README.md
tests/tooling/quality/ci-config.test.ts
tests/tooling/quality/codeql-config.test.ts
tests/tooling/quality/hook-isolation.test.ts
tests/tooling/quality/repository-audit.test.ts
tests/tooling/quality/runtime-boundaries.test.ts
tests/tooling/quality/script-syntax.test.ts
tests/tooling/quality/temporary-directory-alias.test.ts
tests/tooling/quality/test-lanes.test.ts
tests/tooling/quality/text-policy.test.ts
tests/tooling/quality/toolchain-config.test.ts
tests/tooling/quality/typescript-gates.test.ts
tests/tooling/releases/README.md
tests/tooling/releases/publication.test.ts
tests/tooling/releases/release-notes.test.ts
tests/tooling/security/README.md
tests/tooling/security/dependency-scan.test.ts
tests/tooling/security/fingerprints.test.ts
tests/tooling/security/installation-policy.test.ts
tests/tooling/security/installed-tree.test.ts
tests/tooling/security/lock-inventory.test.ts
tests/tooling/security/official-inputs.test.ts
tests/tooling/security/registry-reports.test.ts
tests/tooling/security/standalone-build.test.ts
tests/tooling/security/vulnerability-reviews.test.ts
tests/tooling/submissions/README.md
tests/tooling/submissions/issue-feedback.test.ts
tests/tooling/submissions/issue-forms.test.ts
tests/tooling/submissions/issue-workflow.test.ts
tests/tooling/submissions/markdown.test.ts
tests/tooling/submissions/pull-requests.test.ts
```

### Tooling leaves

```text
tooling/AGENTS.md
tooling/README.md
tooling/acceptance/README.md
tooling/acceptance/build-native-fixture.ts
tooling/acceptance/run-windows-interactive.ts
tooling/acceptance/verify-native-fixture.ts
tooling/app-delivery/README.md
tooling/app-delivery/app-bundles.ts
tooling/app-delivery/app-stage.ts
tooling/app-delivery/archive-extraction.ts
tooling/app-delivery/build-app.ts
tooling/app-delivery/extract-app-zip.ps1
tooling/app-delivery/fresh-installation.ts
tooling/app-delivery/original-archives.json
tooling/app-delivery/original-native-packages.json
tooling/app-delivery/payload-composition.ts
tooling/distribution/README.md
tooling/distribution/artwork-policy.ts
tooling/distribution/audit-plugins.ts
tooling/distribution/build-plugin.ts
tooling/distribution/host-descriptors.ts
tooling/distribution/host-metadata.ts
tooling/distribution/payload-inventory.ts
tooling/distribution/regular-file-tree.ts
tooling/distribution/version-agreement.ts
tooling/governance/README.md
tooling/governance/check-commits.ts
tooling/governance/commit-events.ts
tooling/governance/commit-footer.ts
tooling/governance/commit-grammar.ts
tooling/governance/commit-validation.ts
tooling/licenses/README.md
tooling/licenses/bundled-notices.ts
tooling/licenses/canonical-inputs.ts
tooling/licenses/reviewed-vendors.json
tooling/official-server/README.md
tooling/official-server/catalog-evidence.ts
tooling/official-server/catalog.json
tooling/official-server/release.json
tooling/official-server/reviewed-release.ts
tooling/official-server/smoke-catalog.ts
tooling/quality/README.md
tooling/quality/audit-repository.ts
tooling/quality/check-script-syntax.ts
tooling/quality/check-staged-text.ts
tooling/quality/runtime-boundaries.ts
tooling/quality/text-policy.ts
tooling/releases/README.md
tooling/releases/publish-release.ts
tooling/releases/release-notes.ts
tooling/security/AGENTS.md
tooling/security/README.md
tooling/security/build-standalone.ts
tooling/security/check-security.ts
tooling/security/dependency-scan.ts
tooling/security/dist/README.md
tooling/security/dist/THIRD-PARTY-NOTICES.txt
tooling/security/dist/check-security.mjs
tooling/security/fingerprints.ts
tooling/security/installation-policy.ts
tooling/security/installed-tree.ts
tooling/security/lock-inventory.ts
tooling/security/official-inputs.ts
tooling/security/registry-reports.ts
tooling/security/upstream-pnpm-lock.yaml
tooling/security/vulnerability-reviews.ts
tooling/submissions/README.md
tooling/submissions/github-issues.ts
tooling/submissions/issue-feedback.ts
tooling/submissions/issue-forms.ts
tooling/submissions/markdown.ts
tooling/submissions/publish-issue-feedback.ts
tooling/submissions/pull-requests.ts
```

### Documentation and maintained planning leaves

```text
.superpowers/README.md
.superpowers/plans/2026-10-02-bundled-official-server.md
.superpowers/plans/2026-10-05-claude-code-distribution.md
.superpowers/plans/2026-10-08-host-metadata.md
.superpowers/plans/2026-10-09-mcp-instructions.md
.superpowers/plans/2026-10-17-singleton-app-plan.md
.superpowers/plans/2026-10-18-repository-content-reorganization.md
.superpowers/plans/README.md
docs/README.md
docs/adr/0001-isolated-skill-payload.md
docs/adr/0002-runtime-architecture.md
docs/adr/0003-managed-session-state.md
docs/adr/0004-target-adapters.md
docs/adr/0005-direct-stdio-plugin.md
docs/adr/0006-native-typescript.md
docs/adr/0007-reusable-stdio-entries.md
docs/adr/0008-independent-target-connections.md
docs/adr/0009-process-exit-hooks.md
docs/adr/0010-bundled-official-server.md
docs/adr/0011-mcp-native-lifecycle.md
docs/adr/0012-peer-host-distributions.md
docs/adr/0013-session-owned-exit-cleanup.md
docs/adr/0014-windows-chrome-screenshot-surface.md
docs/adr/0015-explicit-data-directory-isolation.md
docs/adr/0016-toolchain-compatibility.md
docs/adr/0017-singleton-desktop-app.md
docs/adr/0018-mcp-protocol-compatibility.md
docs/adr/README.md
docs/architecture/README.md
docs/architecture/deployment.md
docs/architecture/desktop-runtime.md
docs/architecture/gateway-core.md
docs/architecture/host-plugin-management.md
docs/evidence/README.md
docs/evidence/application-screenshot-validation.md
docs/evidence/host-plugin-research.md
docs/evidence/mcp-native-validation.md
docs/evidence/tauri-close-validation.md
docs/evidence/tauri-screenshot-validation.md
docs/policies/README.md
docs/policies/commits-and-scope.md
docs/policies/continuous-integration.md
docs/policies/documentation.md
docs/policies/git-environment.md
docs/policies/quality.md
docs/policies/releases.md
docs/policies/repository-organization.md
docs/policies/security-exceptions.json
docs/policies/security.md
docs/policies/supply-chain.md
docs/reference/README.md
docs/reference/domain-language.md
docs/reference/host-metadata.md
docs/reference/mcp-http.md
docs/reference/mcp-lifecycle.md
docs/user-guide/README.md
docs/user-guide/compatibility.md
docs/user-guide/configuration.md
docs/user-guide/installation.md
docs/user-guide/privacy.md
docs/user-guide/troubleshooting.md
docs/user-guide/workflow.md
```
