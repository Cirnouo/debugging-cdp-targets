# Continuous integration workflows

This directory owns GitHub Actions workflows.

- `ci.yml` validates commit governance, repository quality, Windows behavior,
  portable simulated CDP, and the Plugin distribution on pushes, manual runs, and pull
  request open/reopen/synchronize/title-edit events without uploading runtime
  data or artifacts.

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
