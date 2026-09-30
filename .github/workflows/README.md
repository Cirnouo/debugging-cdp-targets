# Continuous integration workflows

This directory owns GitHub Actions workflows.

- `ci.yml` validates commit governance, repository quality, Windows behavior,
  portable simulated CDP, and the Plugin distribution on pushes, manual runs, and pull
  request open/reopen/synchronize/title-edit events without uploading runtime
  data or artifacts.
