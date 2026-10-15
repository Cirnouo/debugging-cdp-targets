# GitHub Actions workflows

This directory owns GitHub Actions workflows.

- `codeql.yaml` scans maintained TypeScript/JavaScript, native C# and Actions on
  main pushes, PRs, manual runs and Mondays at 01:47 UTC. It runs security-extended
  queries without a product build or project install. Only analysis jobs receive
  security-events write permission. The C# job verifies that its extracted source
  archive contains the owned native helper before the job can succeed.

- `ci.yaml` validates commit governance and current PR template submissions,
  repository quality, Windows behavior, portable simulated CDP, real Chrome and
  the Plugin distribution on branch pushes, manual runs, weekly runs, and pull
  request open/reopen/synchronize/title-or-body-edit events. Ordinary controlled
  real Chrome jobs upload the fixed safe fixture diagnostic files only on failure.
  The default-off manual Ubuntu startup study is the narrow exception below.
- `release.yaml` runs that same-commit CI through `workflow_call` for newly
  created stable `v<major>.<minor>.<patch>` and prerelease candidate tag pushes.
  Only its downstream publish job has `contents: write`; all checks remain read-only.
  Tag updates, deletion,
  forced pushes and build metadata do not publish. The publisher strictly validates
  SemVer candidates before release API operations; arbitrary legal prerelease labels
  are accepted without a whitelist.
- `issues.yaml` checks the latest labeled Bug/Feature Issue on open, edit, reopen,
  and classification-label changes. Diagnostic-label events are excluded. A
  separate read-only supply-chain gate audits the same trusted default-branch
  event SHA before the feedback job can execute. Both checkouts disable persisted
  credentials. Only the feedback job receives `issues: write`, with the built-in
  token bound only to its publisher step; dependency installation disables scripts
  and pnpm hooks. Invalid content is diagnosed before the publisher fails its job.
  Runs queue per Issue, skip closed Issues, preserve ordinary Issue exemption,
  and re-read live state before writes. Repairs clear only owned diagnosis.
  See the [typed Issue policy](../../docs/policies/commits-and-scope.md#typed-issue-submissions)
  for required label provisioning, ownership and remaining REST race limits.

Supply chain security validates and audits the complete repository lockfile
before creating an installation tree, using a committed standalone Node checker.
It disables lifecycle scripts, pnpmfile hooks and configuration-dependency
loading, then installs, checks the installed graph,
repeats the audits, and verifies the standalone build against its source. The
isolated official Server tree is also reviewed before its actual installation. Commit
messages and Quality wait for it; Windows/Portable/Real Chrome tests wait for Quality. A
failed security check prevents downstream builds. Registry failures also block.

Quality, Windows tests and both Portable tests execute strict TypeScript
typechecking before their regression tests. The required Windows tests job keeps
`needs: quality` and runs `pnpm test` followed by `pnpm test:windows:interactive --allow-gui`
as separate mandatory steps after `pnpm typecheck`, without job/step conditions
or `continue-on-error`. Windows additionally parses the PowerShell helper with
both 5.1 and 7; portable tests remain simulated CDP, not claims of real
Linux/macOS application acceptance. The first security entry is generated
JavaScript so lockfile preflight needs no installed dependencies.

Contributor `pnpm test`, `pnpm test:coverage`, `pnpm verify:push` and pre-push
verification use the default `tests/*.test.ts` lane without launching GUI
fixtures. `pnpm test:windows:interactive` returns a successful explicit skip by
default. Only `pnpm test:windows:interactive --allow-gui` selects the eighteen
interactive cases and requires an interactive Windows desktop; after authorization
it fails on non-Windows. Each file also skips direct Node execution without the
flag. CI/environment detection never grants GUI permission. Both lanes run files
sequentially (default `--test-concurrency=1`, interactive `node:test.run`
concurrency 1), and default coverage keeps the 52% line, 71% branch and
61% function floors. See the [quality policy](../../docs/policies/quality.md)
and [interactive inventory](../../tests/interactive/README.md) for contributor
requirements and native fixture prerequisites.

Record local default-lane verification, any explicit interactive execution and
the remote Windows tests result independently, with their tested commit,
results, prerequisite skips and remaining limits. A passing local pre-push gate
does not establish interactive acceptance; CI requires both lanes.

Weekly CI runs on Mondays at 01:17 UTC (09:17 Asia/Shanghai); CodeQL runs at
01:47 UTC (09:47 Asia/Shanghai). Scheduled commit checks use GitHub's explicit
branch ref and audit its full ancestry, rejecting missing identity or tag refs.

Real Chrome jobs run the official tools and three-connection recovery smokes on
`ubuntu-24.04` and `macos-15`, after their own strict typecheck. Linux requires
Xvfb; macOS starts desktop Chrome directly. Both real smoke commands explicitly
pass `--allow-gui`. Existing Windows CI proves owned native regression behavior;
Tauri/Electron probes remain opt-in local development evidence without new CI
application acquisition or toolchains. The executable path is explicit and
must be an existing actual Chrome binary. Each launch uses an independent
temporary profile and synthetic local page, validates process/listener/endpoint
identity and logs the actual OS and Chrome versions. Missing prerequisites fail;
no browser/profile/content artifacts are uploaded and cleanup uses normal Close.
Failure diagnostics use the reviewed
[official upload-artifact v7.0.2 commit](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9).
The failure-only upload names each artifact by OS, run ID and attempt and
requires successful current initialization before upload.
Initialization returns the existing collection UUID, which later stage, smoke
and summary commands must carry. Refusal cannot mutate or present earlier
collector files as current evidence, and those files are not eligible for upload.
It retains artifacts for seven days, disables hidden files and overwrite, and selects exactly
`job-index.json`, `official-server.events.ndjson`, `official-server.summary.json`,
`entry-recovery.events.ndjson` and `entry-recovery.summary.json` from the separate
`RUNNER_TEMP/dct-fixture-diagnostics` directory. There are no profile, workspace
or temporary-directory wildcards. Jobs other than ordinary real Chrome and the
manual studies below remain artifact-free, and the release publisher uploads no
custom assets. The failure job summary indexes
relative filenames, safe primary stage/operation identity and the artifact link
when upload succeeds. The index, both independent not-run summaries and empty
streams start before prerequisites; collection ownership refuses prior evidence.
Interrupted summary presentation derives the last safe runtime boundary/operation
and count from the stream without requiring successful cleanup. If the first smoke
fails, the second remains not-run under the existing fail-fast shell behavior.
Evidence covers recorded direct checks; historical failure causes remain unknown,
and synchronous instrumentation overhead on real Linux/macOS Chrome is unmeasured.
See [smoke diagnostics and reproduction](../../tests/smoke/README.md#controlled-failure-diagnostics).
New scan and browser checks become required only after their first successful
GitHub runs and review of the CodeQL findings.

The `ubuntu-startup-study` workflow-dispatch input is boolean and defaults to
false. Select the reviewed branch in Actions, choose **Run workflow**, and set
that input to true, or run this single explicitly authorized batch:

```sh
gh workflow run ci.yaml --ref <reviewed-branch> -f ubuntu-startup-study=true
```

Its run-ID-specific concurrency group cannot cancel ordinary CI's workflow/ref
group. All ordinary jobs still execute their full checks, with the same display
names and gates. The additional Ubuntu startup study waits for Quality and
uses exactly three blocks crossed with file logging `on`/`off`, six fresh
`ubuntu-24.04` runner jobs. It uses Node 24.21.0, pnpm 12.4.2 and the fixed actual
Chrome path `/opt/google/chrome/chrome`. Each slot performs the existing frozen
install, typecheck, current collection initialization and prerequisites, then
one `official-server.ts --allow-gui --startup-study --chrome-file-logging on|off`
invocation under `xvfb-run -a`, with its diagnostics directory and collection UUID.
No pre-start Chrome version query, binary hashing, warmup, browser download or
OS package installation is added. There are no retries, replacement slots or
ignored failures; fail-fast is false so one sample's failure does not cancel peers.

Both explicitly selected study jobs upload and index diagnostics after success as well as
failure, guarded by `always()` and successful current initialization. It retains
the exact same five safe filenames for seven days, with hidden files and overwrite
disabled, warning on missing files. Artifact names are
`ubuntu-startup-study-block-<block>-logging-<on|off>-<run-id>-<attempt>`.
`entry-recovery` remains not-run with its empty stream. Normal real Chrome
artifacts keep their original failure-only guard; release publication gains no
assets. Raw Chrome logs, profiles and private scratch remain excluded.

The primary measure is the first readiness outcome and monotonic duration.
Secondary evidence includes owned-listener time, endpoint outcomes, safe process
counters, closed wait kinds, system PSI, native/collector costs and cleanup.
Both arms retain collectors, capture, display preflight and sampler; the off arm's
absent Chrome log is expected. This is one batch of six pilot samples, with
cancelled or incomplete slots recorded without replacement. Fresh runners do not
establish cold caches, and blocks are not matched machines. Arm differences are
association only; six successes mean not reproduced and root cause unknown.
Missing terminal/cleanup records or capped/truncated evidence limits conclusions.
The study is diagnostic evidence, not full acceptance. See the
[bounded study procedure](../../tests/smoke/README.md#bounded-ubuntu-startup-study)
for exact local arguments and the unchanged collection budgets.

The separate `ubuntu-readahead-study` boolean input also defaults to false. Set
only this input for an explicitly authorized queue intervention batch:

```sh
gh workflow run ci.yaml --ref <reviewed-branch> -f ubuntu-readahead-study=true
```

The two research inputs are mutually exclusive. Selecting both fails Quality
before any research Chrome starts, and neither research job executes. The new
study also uses a run-ID-specific concurrency group, the existing supply-chain
and Quality gates, trusted frozen installation, typecheck, current collection
initialization and Xvfb prerequisites. Ordinary job names, commands and gates
remain the same, including both real Chrome acceptance smokes.

The six explicit matrix allocations are slot/block/RA KiB:
`1/1/128`, `2/1/1024`, `3/2/1024`, `4/2/128`, `5/3/128`, `6/3/1024`.
This order is an allocation order, not chronological scheduling, and blocks do
not pair samples on a machine. Logging is fixed on. An admission failure retains
its assigned slot with zero starts; an admitted slot starts Chrome at most once.
There are no retries, replacement slots, warmups, downloads, extra OS packages
or pre-start Chrome version queries or binary hashes.

The new artifacts are named
`ubuntu-readahead-study-slot-<slot>-block-<block>-ra-<128|1024>-<run-id>-<attempt>`.
They use the same five fixed files, successful current-initialization guard,
`always()` upload/index, seven-day retention, hidden-files exclusion and disabled
overwrite. All assigned outcomes, including unavailable admission, missing CDP,
timeout, cleanup or restoration failure, remain visible. No raw browser log or
profile is uploaded. See the
[readahead procedure](../../tests/smoke/README.md#bounded-ubuntu-readahead-study)
for queue identity, pending-helper/actual-resource-exit restoration and terminal
observation rules. Compare only shared software, original RA and visible queue
configuration strata; preserve request-count/read-byte tradeoffs and overlapping
or unavailable device windows. An all-success batch is evidence that the failure
was not reproduced, and does not establish a repair.

Release publication additionally requires an annotated tag whose peeled commit
matches the event and checkout and is an ancestor of `origin/main`, agreeing
Package/Plugin/Skill versions, and one nonempty, ISO-dated Changelog entry.
The annotated tag object must match the original push event both locally and
on GitHub, including when a replacement points to the same commit. Release API
requests use the existing verified tag without `target_commitish`, so historical
main commits do not request an additional workflow-writing permission.
The English body uses What's Changed with the Changelog's category headings,
then generated New Contributors when present, then Full Changelog. Generated
PR change lists are discarded. The previous tag comes from GitHub's latest
published stable/full release for both prereleases and stable publication. Without
a stable baseline, notes link to the current tag's commit history, even when
prereleases exist.
GitHub renders its native Contributors footer from user mentions in the notes.

The publisher creates a draft before publishing, resumes matching drafts found
through paginated authenticated release listings, and skips published releases
only after checking the expected classification and remote tag, without editing them.
Draft and published responses must match the requested tag, draft state and
classification. Stable releases use `prerelease: false` and `make_latest: legacy`;
prereleases use `prerelease: true` and `make_latest: false`. Failures leave drafts
for a rerun and never delete tags or releases. Same-tag runs queue instead of
cancelling publication. Only
GitHub's automatic source ZIP/TAR.GZ links are provided; no custom assets are
uploaded. The publish step receives only the built-in GitHub token, with no
additional secrets or immutable-release setting checks. The repository setting
must be enabled separately before publication. See the release policy for
pre-tag installation acceptance, cumulative Changelog snapshots, and explicit
authorization for every release. GitHub prereleases do not create a separate
Marketplace channel; repository-based installation is unchanged.
