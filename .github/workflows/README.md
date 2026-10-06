# GitHub Actions workflows

This directory owns GitHub Actions workflows.

- `codeql.yml` scans maintained TypeScript/JavaScript, native C# and Actions on
  main pushes, PRs, manual runs and Mondays at 01:47 UTC. It runs security-extended
  queries without a product build or project install. Only analysis jobs receive
  security-events write permission. The C# job verifies that its extracted source
  archive contains the owned native helper before the job can succeed.

- `ci.yml` validates commit governance and current PR template submissions,
  repository quality, Windows behavior, portable simulated CDP, real Chrome and
  the Plugin distribution on branch pushes, manual runs, weekly runs, and pull
  request open/reopen/synchronize/title-or-body-edit events without uploading
  runtime data or artifacts.
- `release.yml` runs that same-commit CI through `workflow_call` for newly
  created stable `v<major>.<minor>.<patch>` and prerelease candidate tag pushes.
  Only its downstream publish job has `contents: write`; all checks remain read-only.
  Tag updates, deletion,
  forced pushes and build metadata do not publish. The publisher strictly validates
  SemVer candidates before release API operations; arbitrary legal prerelease labels
  are accepted without a whitelist.
- `issues.yml` checks the latest labeled Bug/Feature Issue on open, edit, reopen,
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
typechecking before their regression tests. Windows additionally parses the
PowerShell helper with both 5.1 and 7; portable tests remain simulated CDP, not
claims of real Linux/macOS application acceptance. The first security entry is
generated JavaScript so lockfile preflight needs no installed dependencies.

Weekly CI runs on Mondays at 01:17 UTC (09:17 Asia/Shanghai); CodeQL runs at
01:47 UTC (09:47 Asia/Shanghai). Scheduled commit checks use GitHub's explicit
branch ref and audit its full ancestry, rejecting missing identity or tag refs.

Real Chrome jobs run the official tools and three-connection recovery smokes on
`ubuntu-24.04` and `macos-15`, after their own strict typecheck. Linux requires
Xvfb; macOS starts desktop Chrome directly. The executable path is explicit and
must be an existing actual Chrome binary. Each launch uses an independent
temporary profile and synthetic local page, validates process/listener/endpoint
identity and logs the actual OS and Chrome versions. Missing prerequisites fail;
no browser/profile/content artifacts are uploaded and cleanup uses normal Close.
New scan and browser checks become required only after their first successful
GitHub runs and review of the CodeQL findings.

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
