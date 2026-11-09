# Continuous integration

Read this policy before changing CI workflows, jobs, required checks, diagnostic
uploads, scans or monitoring. Use the executable configuration for each
workflow. [CI](../../.github/workflows/ci.yaml)
[CodeQL](../../.github/workflows/codeql.yaml)
[Release](../../.github/workflows/release.yaml)
[Issue forms](../../.github/workflows/issues.yaml)

Use the existing owners for the complete local verification, installation
trust, publication and submission procedures.
[Quality](quality.md#verification)
[Supply chain](supply-chain.md#installation-and-scan-order)
[Releases](releases.md)
[Commits and submissions](commits-and-scope.md)

## Triggers and permissions

CI runs on branch pushes, PRs to `main` opened, reopened, synchronized or
edited, manual dispatch, reusable `workflow_call` and the weekly schedule.
CodeQL runs on main pushes, PRs to main, manual dispatch and its weekly schedule.
Release considers newly created stable or prerelease tag candidates. Issue
forms subscribes to `opened`, `edited`, `reopened`, `labeled` and `unlabeled`
Issue events. The Release and Issue sections below describe their entry guards.

Workflows default to `contents: read` and use reviewed full-SHA third-party
Actions. Ordinary CI uses cancellable `ci-{workflow}-{ref}` concurrency.
CodeQL also cancels superseded runs for the same ref. Same-tag Release runs
and per-Issue feedback runs queue. Only CodeQL analysis jobs receive
`security-events: write`, only Release publication receives `contents: write`,
and only Issue feedback receives `issues: write`. The two publisher steps
each receive their own scoped built-in token.

## Jobs and command order

Ordinary jobs use Node 24.21.0 and exact pnpm 12.4.2 after checkout. The separate
Node compatibility job selects latest stable 24.x. All dependency installs in
the workflow use the frozen lockfile.

| Job | Dependency and order |
| --- | --- |
| Supply chain security | First. `node tooling/security/dist/check-security.mjs --phase lockfile --root .`, `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm check:security`, then `pnpm check:security:build`. |
| Commit messages | After Supply chain security. Checkout with full history, `pnpm install --frozen-lockfile`, then `pnpm check:commits`. |
| Quality | After Supply chain security. `pnpm install --frozen-lockfile`, `pnpm check:repo`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm check:scripts`, `pnpm test:coverage`, `pnpm check:distribution`, `pnpm check:build`, then `pnpm check:app`. |
| Node compatibility (24.x) | After Quality. See [Node compatibility](#node-compatibility) for the exact order. |
| Windows tests | After Quality. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm test:windows:interactive --allow-gui`, `pnpm check:scripts`, the arbitrary-cwd runtime suite, then `pnpm check:distribution`. |
| Real Chrome (windows-latest) | After Quality. `pnpm install --frozen-lockfile`, `pnpm typecheck`, collection initialization, Chrome preflight, official tools acceptance, recovery acceptance, and guarded failure upload/indexing. See [Real Chrome and failure diagnostics](#real-chrome-and-failure-diagnostics). |

The first job starts with the committed dependency-free lockfile audit before
an installation tree exists. CI disables pnpmfile hooks and configuration
dependency loading for the security job and uses a script-disabled first
install. The complete audit checks the installed graph and full vulnerability
and signature coverage, reviews the isolated official Server tree before
its install, then the offline comparator verifies the standalone checker and
original notices against maintained source. Security and registry failures
block downstream installation and builds. Preserve the success dependency,
without `continue-on-error`, always-run downstream builds, registry-error
suppression or audit repair. Keep trust decisions and exceptions
within the [supply-chain procedure](supply-chain.md#installation-and-scan-order).
`pnpm check:security` is a network gate separate from offline tests and
`verify:push`.

Commit messages checks topology, source branch, raw PR title and the
predicted squash header with the actual PR number. It independently validates
the complete current PR body against the template. PR descriptions follow
Markdown submission requirements. Commitlint body/footer width and separator
rules apply to commit messages. A submission format failure blocks merge.
Editing the title or body triggers the check again. Before merging, compare
the final header with the validated title plus the actual PR suffix and run
the exact curated message through the maintained raw-stdin validator. The PR
job checks the supplied title and body. Later history checks validate the
actual stored commit without rewriting it, retrofitting the current PR
template or granting historical exceptions.
[Commit and PR submission rules](commits-and-scope.md#commits)

Windows tests runs both default and interactive commands as separate mandatory
steps after typecheck. It keeps both PowerShell parsers, 5.1 and 7, in the
script syntax check. The arbitrary-cwd step resolves the repository root,
enters `RUNNER_TEMP`, runs `node --test` on the absolute
`tests/plugin-runtime.test.ts` path and restores location in `finally`.
Keep mandatory acceptance steps free of job/step conditions and
`continue-on-error`. The exact safe inventory, sequential execution and
coverage floors belong to the [verification policy](quality.md#verification).
Record local default, explicitly authorized interactive and remote Windows
results independently with their tested commit, outcomes, prerequisite skips
and remaining limits. The remote interactive result requires its own run.

Windows is the production App and target platform. The Ubuntu-hosted
security, governance, Quality, latest-Node and applicable CodeQL jobs
exercise shared checks within their own scopes.

## Node compatibility

`Node compatibility (24.x)` runs on `ubuntu-latest` after Quality. It uses
exact pnpm 12.4.2 and `setup-node` with `node-version: '24.x'` and
`check-latest: true`. This selects the newest available stable Node 24 even
when the runner cache contains an older matching release.
[Reviewed setup-node documentation](https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/docs/advanced-usage.md#check-latest-version)

After the normal frozen install, it runs `pnpm typecheck`, `pnpm test`,
`pnpm check:build`, `pnpm check:security:build`, `pnpm check:app` and
`pnpm smoke:official --installed` in that order. The final command verifies
the installed original release, lists the actual catalog and closes its
ordinary-Node stdio child normally. This establishes Ubuntu compatibility for
the exercised default regressions, build comparisons and installed catalog.
GUI, latest-24 Windows, browser and native App delivery have separate
acceptance boundaries. Baseline jobs retain Node 24.21.0, and the installed
smoke has its own mode and evidence.
[Official smoke inventory](../../tests/smoke/README.md)

## Real Chrome and failure diagnostics

`Real Chrome (windows-latest)` is a mandatory single Windows job after Quality
with a 20-minute budget. It typechecks before the two existing real acceptance
smokes and supplies `--allow-gui` once to each. After frozen installation
and typecheck, PowerShell joins `RUNNER_TEMP/dct-fixture-diagnostics` and
initializes the current collection. The blocking prerequisite then calls
`requireChromeSmokeExecutable()` for the configured regular executable
`C:/Program Files/Google/Chrome/Application/chrome.exe`, before acquiring
a profile or target. Runner availability is established at execution. Missing
or nonregular Chrome fails the prerequisite. Keep the configured browser,
original deadlines and one attempt per smoke. Preserve genuine acceptance
without alternate installations, browser downloads, headless substitution,
ignored failures or timeout expansion.

Both smokes use the test-only real-Core/SDK HTTP fixture with verified ordinary
Node and original official Server bytes. The first checks official tools on
genuine Chrome. The second checks three-connection recovery. Each uses
independent temporary profiles and synthetic local pages, validates actual
process/listener/endpoint identity and records actual OS and Chrome versions.
Keep Windows visible-console monitoring, normal Close, observed exit and
managed-root deletion assertions. Same-commit reusable Release CI runs both
smokes. The evidence covers those source fixtures. App GUI, installer, default
admission and Windows arm64 delivery require their own evidence. Tauri and
Electron probes remain separately opt-in local work.

### Collection and exit handling

The dependency-free `node tests/smoke/fixture-ci.ts init` command creates
the index, both independent `not-run` envelopes and both empty streams
before browser prerequisites. A fresh collection refuses to overwrite earlier
evidence. Capture the native exit status immediately and accept exactly one
valid fresh UUID after exit zero. On refusal, report `initialized=false` and
an empty collection ID. The metadata step explicitly exits successfully after
handling that status.

After the prerequisite succeeds, stage `official-server` with
`node tests/smoke/fixture-ci.ts stage` and run
`node tests/smoke/official-server.ts --allow-gui` with the joined
`--diagnostics` directory and the current `--collection-id`. Only after
official tools succeeds, stage `entry-recovery` and run
`node tests/smoke/entry-recovery.ts --allow-gui` with the same directory and ID.
Init and stage metadata have no authority to skip mandatory acceptance. The
PowerShell steps disable automatic native-error handling and capture
`$LASTEXITCODE` immediately after the blocking preflight and each smoke.
Propagate that exact nonzero exit before a subsequent command can mask it.
An official-tools failure leaves recovery `not-run`. Retain the original
primary failure while cleanup and its assertions run in order.
[Exact PowerShell reproduction and interpretation](../../tests/smoke/README.md#controlled-failure-diagnostics)

The source fixture uses a safe subscriber preload. Both owned smoke children
omit inherited `NODE_OPTIONS`. Streaming starts before completion with fixed event, record
and byte caps and exposes truncation, rejection or write limitations. The
parent owns summaries. Final and interrupted presentation derive safe
progress from the bounded stream. Monotonic durations and remaining budgets
leave the production readiness predicate and wall-clock deadline intact.
Sealed native comparison binds exact clean source and the complete App stage,
and marks development receipts dirty. Fixture exit establishes the recorded
fixture outcome. Complete lifecycle attribution, historical failure causes
and real instrumentation overhead require separate evidence.

### Failure upload and summary

Upload requires `failure()` plus successful current initialization. Use the
artifact name `controlled-chrome-windows-latest-<run-id>-<attempt>` and select
the following five files from the dedicated runner-temp directory.

- `job-index.json`
- `official-server.events.ndjson`
- `official-server.summary.json`
- `entry-recovery.events.ndjson`
- `entry-recovery.summary.json`

Retain artifacts for seven days. Disable hidden files and overwrite, warn if
no files match, and use exact filenames without directory wildcards. Keep the
other jobs artifact-free and the release publisher free of custom assets.
[Reviewed upload-artifact v7.0.2 commit](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9)

The failure index runs even if initialization failed. It then reports only
the current-collection limitation. With valid initialization,
`node tests/smoke/fixture-ci.ts summary` receives the same directory and UUID.
It indexes relative filenames, the safe primary failure and stage/operation,
bounded progress and an artifact link when available. An interrupted run can
show the last safe boundary and count before cleanup completes. An earlier or
refused collection is ineligible for the current summary and upload.

The files carry only closed stage/outcome metadata, UUIDs, numbers and bounded
allowlisted error cause codes. Keep raw errors, messages/stacks, browser and
Gateway stderr, tool and page content, HTTP headers and bodies, environment,
argv, process tables, locks, hostnames, account data, profiles and private paths
out of evidence uploads. A valid collection may project bounded private Chrome
logs to closed categories, severity counts and read/cleanup limitation flags.
Keep raw logs outside profiles and the upload list. Raw logging has no inherent
write cap. Delete private scratch only after successful acceptance and the
existing cleanup proofs. Missing or unmatched logs leave cause unknown, and
optional capture failure leaves the acceptance outcome intact.

### Retired hosted study and portable jobs

The portable product matrix, POSIX real-Chrome matrix and Ubuntu startup-study
job and dispatch input are retired, including the study-specific concurrency and
success-upload exception. The sampler, study mode and controlled regressions
remain pending the separate target-native cleanup. Dated failures and
observations retain their original method and scope. Preserve ordinary
superseded-ref cancellation and the current failure-only collection contract.
[Historical and local study method](../../tests/smoke/README.md#bounded-ubuntu-startup-study)

## CodeQL

Advanced CodeQL scans maintained JavaScript/TypeScript, native C# and GitHub
Actions using `security-extended` queries and reviewed v4 Actions. All three
language jobs use build mode `none`, with the C# job on Windows. Only analysis
jobs receive security-event write permission. CodeQL runs without building the
product or installing project dependencies. The scan selects `src`, `tooling`
and `.github`. Generated output and unchanged upstream trees keep their own
distribution, integrity and supply-chain checks.
[CodeQL configuration](../../.github/codeql-config.yaml)
[Reviewed CodeQL v4 commit](https://github.com/github/codeql-action/tree/2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2)

The Windows C# job checks the database's `csharp/src.zip` for exactly one
extracted source member for each of these paths.

- `src/adapters/windows-native-process.cs`
- `src/adapters/windows-deployment-authority.cs`
- `src/adapters/windows-deployment-create.cs`

Missing or ambiguous extraction fails the check. Extraction establishes
maintained-source coverage. Native compilation, execution and delivery have
separate evidence requirements.

## Required checks and monitoring

GitHub ruleset `24445278` protects `main`. It requires PRs, up-to-date branches
and linear history, blocks force pushes and deletion, has no bypass actors
and requires these eight GitHub Actions contexts in strict mode.

- `Supply chain security`
- `Commit messages`
- `Quality`
- `Windows tests`
- `CodeQL (javascript-typescript)`
- `CodeQL (csharp)`
- `CodeQL (actions)`
- `Real Chrome (windows-latest)`

`Node compatibility (24.x)` runs outside the required set. Single-maintainer
PRs require zero additional approvals. Squash is the sole merge method.
The `PR_TITLE` and `BLANK` defaults start with the PR title and an empty
body. The merge author curates the complete message with the actual PR suffix.
Actions runs after GitHub accepts the push. The generated pre-push hook gates
the local transfer. [Commit policy](commits-and-scope.md#commits)
[Git hook initialization](git-environment.md#local-git-hook-initialization)

Workflow files and ruleset settings have separate owners. A change to required
checks needs separate explicit authorization. Before replacing a context,
observe its genuine success under its actual name on the final head. Keep all
other governance rules and the active checks enforced during the transition.
Status aliases and administrative bypass supply no replacement evidence.

The separate code scanning rule requires CodeQL results and rejects high or
critical alerts on reported lines in the PR diff. Review existing findings
through the alert interface. Initial CodeQL scans returned no findings and
confirmed the native helper extraction exercised at the time. The former
POSIX real-Chrome jobs passed before their observed names became required.
Use current run evidence for Windows
acceptance and inspect the recorded runner and Chrome versions.
[GitHub code scanning merge protection](https://docs.github.com/en/code-security/concepts/code-scanning/merge-protection)
[Tested compatibility](../user-guide/compatibility.md)

CI runs the same gates every Monday at 01:17 UTC (09:17 Asia/Shanghai), even
without a new commit. CodeQL runs at 01:47 UTC (09:47 Asia/Shanghai). Scheduled
commit auditing requires the explicit GitHub branch ref and complete ancestry.
Missing or contradictory identities, tag refs, shallow history and detached
branch inference fail closed. For a forced push whose previous commit is
unavailable, the audit checks every ancestor of the new head in complete
history. An ordinary push still requires its base. Missing heads and shallow
fallbacks fail. The audit's recovery path grants no authority to rewrite history.

Dependabot alerts are enabled. Full-SHA Action pins are outside version-based
Dependabot alerts. Review their advisories and exact references separately.
Keep updates human-reviewed and follow the existing dependency and original
release evidence rules, including bounded exceptions and embedded-library
coverage limits. [Supply-chain policy](supply-chain.md)

## Release and Issue workflow boundaries

New stable or prerelease tag candidates reach the separate Release workflow.
Tag updates, deletions, forced tags and versions with build metadata cannot
publish. Release calls the same-commit read-only `ci.yaml` workflow and runs
its downstream publisher only after success. CodeQL remains a separate
workflow. Only the publish job has `contents: write`, and only its publisher
step receives the built-in token. Same-tag runs queue and the publisher
provides no custom assets. Read the publication procedure before tag
preparation or publication for independently versioned App and Plugin/Skill
groups, original tag identity, notes, draft/resume and explicit authorization.
[Tag-triggered GitHub publication](releases.md#tag-triggered-github-publication)

The read-only Issue supply-chain job skips `labeled` and `unlabeled` events
for `template: invalid` to avoid recursion. Both Issue jobs check out the
same trusted default-branch event SHA with persisted checkout credentials
disabled. Before feedback, the supply-chain job must pass all four commands
in the Supply chain security row in the same order.
[Jobs and command order](#jobs-and-command-order)

Both jobs set `PNPM_CONFIG_IGNORE_PNPMFILE=true` and
`PNPM_CONFIG_CONFIG_DEPENDENCIES={}` to disable pnpmfile hooks and
configuration-dependency loading. Feedback installs audited dependencies with
`pnpm install --frozen-lockfile --ignore-scripts`. Only feedback receives `issues: write`, with
the built-in token bound only to
`node tooling/submissions/publish-issue-feedback.ts`. Runs queue per Issue and
skip closed Issues. The publisher re-reads live state before writing, reports
invalid content before failing and clears only owned diagnosis on repair.
Ordinary Issues remain exempt. Read the typed Issue procedure before changing
classification, feedback ownership or write behavior.
[Typed Issue submissions](commits-and-scope.md#typed-issue-submissions)
