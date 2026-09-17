# Continuous integration workflows

This directory owns GitHub Actions workflows.

- `ci.yml` validates commit governance, repository quality, Windows behavior,
  and the installable Skill distribution on pushes, manual runs, and pull
  request open/reopen/synchronize/title-edit events without uploading runtime
  data or artifacts.
