# GitHub Actions workflows

This directory owns GitHub Actions workflows.

- `codeql.yaml` scans maintained TypeScript/JavaScript, native C# and Actions on
  main pushes, PRs, manual runs and Mondays at 01:47 UTC. It runs security-extended
  queries without a product build or project install. Only analysis jobs receive
  security-events write permission. The C# job verifies that its extracted source
  archive contains the owned native helper before the job can succeed.

- `ci.yaml` validates commit governance and current PR template submissions,
  repository quality, Windows behavior, real Windows Chrome and
  the Plugin distribution on branch pushes, manual runs, weekly runs, and pull
  request open/reopen/synchronize/title-or-body-edit events. The controlled
  real Chrome job uploads the fixed safe fixture diagnostic files only on failure.
  Quality also verifies App bundle/native-input/license composition. Latest-24
  Ubuntu catalog smoke explicitly uses the independently verified installed
  original release; this does not establish App/native delivery acceptance.
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
messages and Quality wait for it; Windows tests, Real Chrome and Node compatibility
wait for Quality. A failed security check prevents downstream builds. Registry
failures also block. The six CI display names are Supply chain security, Commit
messages, Quality, Node compatibility (24.x), Windows tests and
Real Chrome (windows-latest). CodeQL remains in its separate workflow.

Quality, Windows tests, Real Chrome and Node compatibility execute strict TypeScript
typechecking before their regression tests. The required Windows tests job keeps
`needs: quality` and runs `pnpm test` followed by `pnpm test:windows:interactive --allow-gui`
as separate mandatory steps after `pnpm typecheck`, without job/step conditions
or `continue-on-error`. Windows additionally parses the PowerShell helper with
both 5.1 and 7. Ubuntu-hosted security, governance, Quality, Node compatibility
and CodeQL checks retain shared regression value without Linux App support.
The first security entry is generated
JavaScript so lockfile preflight needs no installed dependencies.

Contributor `pnpm test`, `pnpm test:coverage`, `pnpm verify:push` and pre-push
verification use the safe default inventory in the
[verification policy](../../docs/policies/quality.md#verification), including
its exact nested suites, without launching GUI fixtures.
`pnpm test:windows:interactive` returns a successful explicit skip by default. Only `pnpm test:windows:interactive --allow-gui` selects the eighteen
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

`Real Chrome (windows-latest)` runs the unchanged official tools and
three-connection recovery smokes after its own strict typecheck, within the
existing 20-minute job budget. Both commands explicitly pass `--allow-gui`.
The job configures `C:/Program Files/Google/Chrome/Application/chrome.exe` and
calls `requireChromeSmokeExecutable()` to check that exact path before profile
or target acquisition. Actual runner availability is unknown until the job
runs. Missing Chrome is a prerequisite failure; no installer, alternate
installation, headless substitute, retry or timeout increase is provided.
Each launch uses an independent temporary profile and synthetic local page,
validates process/listener/endpoint identity and logs actual OS/Chrome versions.
Normal Close, real exit and managed-root deletion assertions remain mandatory.
This source-fixture result does not qualify the GUI App, installer, default
admission or Windows arm64 native delivery. Tauri/Electron application probes
remain separate opt-in development evidence.

After trusted frozen installation and typecheck, PowerShell initializes the
current collection before the blocking Chrome preflight. Initialization captures
its native status immediately and reports `initialized=true` only after success
with a valid fresh UUID; otherwise it reports false and an empty collection ID.
Only that diagnostic step explicitly succeeds after handling its status. Failed
init or stage metadata cannot skip either mandatory smoke. Both smoke commands
carry the captured ID and joined `RUNNER_TEMP/dct-fixture-diagnostics` path.
Preflight and each smoke immediately capture and check their own native exit
status. A failed official smoke skips recovery, whose envelope remains not-run;
later metadata or summary commands cannot replace the failure.

Failure diagnostics use the reviewed
[official upload-artifact v7.0.2 commit](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9).
Upload requires failure and successful current initialization, with a Windows,
run-ID and attempt artifact name. It retains artifacts for seven days, disables
hidden files and overwrite, and selects exactly `job-index.json`,
`official-server.events.ndjson`, `official-server.summary.json`,
`entry-recovery.events.ndjson` and `entry-recovery.summary.json` from that separate
runner-temp directory. There are no profile, workspace or temporary-directory
wildcards. All other jobs remain artifact-free, and the release publisher
uploads no custom assets. No browser content or raw logs are uploaded.

The index, both independent not-run envelopes and empty streams precede browser
prerequisites. Stage, smoke and summary carry the fresh initialization UUID.
Refusal preserves earlier collector files and excludes them from current evidence
and upload. The failure summary runs even when initialization failed, presenting
only a current-collection limitation in that case. Otherwise it indexes relative
filenames, safe primary stage/operation identity, bounded stream progress and the
artifact link when upload succeeds, without requiring successful cleanup.
Recorded checks do not establish complete lifecycle attribution or explain
historical failures. See
[smoke diagnostics and reproduction](../../tests/smoke/README.md#controlled-failure-diagnostics).

The portable product matrix, POSIX real-Chrome matrix and baseline Ubuntu
startup-study job/input are retired. Ordinary CI retains cancellable
`ci-{workflow}-{ref}` concurrency. The baseline sampler, study mode and controlled
tests remain pending their later complete target-native deletion cut; they have
no current CI execution or success-upload exception. Historical failed runs and
dated observations remain historical evidence.

Workflow configuration does not update the active main Ruleset. After genuine
final-head Windows replacement success, a separately approved settings change
must remove only Portable tests (ubuntu-latest), Portable tests (macos-latest),
Real Chrome (ubuntu-24.04) and Real Chrome (macos-15), and add only the observed
Real Chrome (windows-latest) context. Existing common/Windows/CodeQL requirements
and all governance restrictions stay in place. Until that transition, the old
requirements still block merge; aliases and administrative bypass are prohibited.

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
