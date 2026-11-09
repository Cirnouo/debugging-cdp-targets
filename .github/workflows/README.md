# GitHub Actions workflows

This directory owns GitHub Actions workflows. Before changing CI workflows,
jobs, required checks, diagnostic uploads, scans or monitoring configuration,
read the [CI policy](../../docs/policies/continuous-integration.md).

- `ci.yaml` runs supply-chain and contribution checks, Quality, latest-24
    Ubuntu compatibility, Windows tests and genuine Windows Chrome acceptance.
    [Jobs and command order](../../docs/policies/continuous-integration.md#jobs-and-command-order)
    [Chrome acceptance and failure diagnostics](../../docs/policies/continuous-integration.md#real-chrome-and-failure-diagnostics)
- `codeql.yaml` scans maintained JavaScript/TypeScript, C# and Actions. Its
    Windows C# job verifies all three required source archive members.
    [CodeQL scope and extraction](../../docs/policies/continuous-integration.md#codeql)
- `release.yaml` runs same-commit read-only CI before its separate publish job.
    Read the release policy before preparing a tag or publishing.
    [Tag-triggered publication](../../docs/policies/releases.md#tag-triggered-github-publication)
- `issues.yaml` audits the trusted default-branch event commit before feedback.
    Read the typed Issue policy before changing classification, owned feedback
    or write behavior.
    [Workflow permissions and boundaries](../../docs/policies/continuous-integration.md#release-and-issue-workflow-boundaries)
    [Typed Issue submissions](../../docs/policies/commits-and-scope.md#typed-issue-submissions)

Before changing a required check, read the active ruleset and replacement
procedure. [Required checks and monitoring](../../docs/policies/continuous-integration.md#required-checks-and-monitoring)

Use the local verification policy for the default test inventory, coverage and
explicit GUI opt-in. Record local default tests, any explicit interactive run
and remote acceptance as separate evidence.
[Verification](../../docs/policies/quality.md#verification)
