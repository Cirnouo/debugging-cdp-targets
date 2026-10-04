# GitHub automation

This directory owns repository-hosted automation configuration.
Its index uses this filename so GitHub displays the root README on the
repository home page.

- `workflows/` contains read-only continuous integration and gated tag-triggered
  Release publication, with documented trigger and job ownership.
- `ISSUE_TEMPLATE/` contains bug and feature forms and private security routing.
- `PULL_REQUEST_TEMPLATE.md` guides change descriptions and verification evidence.
- `codeql-config.yml` limits security analysis to maintained code and workflows.
