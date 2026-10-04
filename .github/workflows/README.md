# GitHub Actions workflows

This directory owns GitHub Actions workflows.

- `codeql.yml` scans maintained TypeScript/JavaScript, native C# and Actions on
  main pushes, PRs, manual runs and Mondays at 01:47 UTC. It runs security-extended
  queries without a product build or project install. Only analysis jobs receive
  security-events write permission. The C# job verifies that its extracted source
  archive contains the owned native helper before the job can succeed.

- `ci.yml` validates commit governance, repository quality, Windows behavior,
  portable simulated CDP, and the Plugin distribution on branch pushes, manual runs, weekly runs, and pull
  request open/reopen/synchronize/title-edit events without uploading runtime
  data or artifacts.
- `release.yml` runs that same-commit CI through `workflow_call` for newly
  created `v<major>.<minor>.<patch>` tag pushes. Only its downstream publish job
  has `contents: write`; all checks remain read-only. Tag updates, deletion,
  forced pushes, prereleases and build metadata do not publish.

Supply chain security validates and audits the complete repository lockfile
before creating an installation tree, using a committed standalone Node checker.
It disables lifecycle scripts, pnpmfile hooks and configuration-dependency
loading, then installs, checks the installed graph,
repeats the audits, and verifies the standalone build against its source. The
isolated official Server tree is also reviewed before its actual installation. Commit
messages and Quality wait for it; Windows/Portable tests wait for Quality. A
failed security check prevents downstream builds. Registry failures also block.

Quality, Windows tests and both Portable tests execute strict TypeScript
typechecking before their regression tests. Windows additionally parses the
PowerShell helper with both 5.1 and 7; portable tests remain simulated CDP, not
claims of real Linux/macOS application acceptance. The first security entry is
generated JavaScript so lockfile preflight needs no installed dependencies.

Weekly CI runs on Mondays at 01:17 UTC (09:17 Asia/Shanghai); CodeQL runs at
01:47 UTC (09:47 Asia/Shanghai). Scheduled commit checks use GitHub's explicit
branch ref and audit its full ancestry, rejecting missing identity or tag refs.

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
published full release; the first release links to its tag's commit history.
GitHub renders its native Contributors footer from user mentions in the notes.

The publisher creates a draft before publishing, resumes matching drafts found
through paginated authenticated release listings, and skips published releases
without editing them. Failures leave drafts for a rerun and never delete tags
or releases. Same-tag runs queue instead of cancelling publication. Only
GitHub's automatic source ZIP/TAR.GZ links are provided; no custom assets are
uploaded. The publish step receives only the built-in GitHub token, with no
additional secrets or immutable-release setting checks. The repository setting
must be enabled separately before publication. See the release policy for
pre-tag installation acceptance and first-publication authorization.
