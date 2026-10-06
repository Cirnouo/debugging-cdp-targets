# GitHub automation

This directory owns repository-hosted automation configuration.
Its index uses this filename so GitHub displays the root README on the
repository home page.

- `workflows/` contains read-only continuous integration and gated tag-triggered
  Release publication, with documented trigger and job ownership.
- `ISSUE_TEMPLATE/` contains bug and feature forms and private security routing.
- `PULL_REQUEST_TEMPLATE.md` is the canonical current PR structure and checklist
  source enforced remotely by Commit messages. It guides verification evidence,
  optional Issue associations and other PR references, and generated squash suffixes.
- `codeql-config.yml` limits security analysis to maintained code and workflows.
