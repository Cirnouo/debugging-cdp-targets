# Continuous integration workflows

This directory owns GitHub Actions workflows.

- `ci.yml` validates commit governance, repository quality, Windows behavior,
  portable simulated CDP, and the Plugin distribution on pushes, manual runs, and pull
  request open/reopen/synchronize/title-edit events without uploading runtime
  data or artifacts.

Supply chain security installs with lifecycle scripts disabled and audits both
complete repository dependencies and an isolated official Server tree. Commit
messages and Quality wait for it; Windows/Portable tests wait for Quality. A
failed security check prevents downstream builds. Registry failures also block.
