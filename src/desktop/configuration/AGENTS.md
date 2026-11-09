# Configuration model and atomic store

Parent instructions apply cumulatively. Before changing a schema, migration, load,
backup, save or its actual consumers, read [ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md)
and the [accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md).
Persist configuration only; never sessions, jobs, registration bearers or targets.

Exact model.ts owns AppConfiguration/AppConfigurationState/AppHostSelection and
AppAppearance TYPEs, ConfigurationMigrationResult/ConfigurationMigrationStep TYPEs,
defaultAppConfiguration, parseAppConfiguration, runConfigurationMigrations,
migrateAppConfiguration and applyAppConfiguration VALUEs. Its sole dependency is
shared/errors. Keep schema 2 current, the real schema 1-to-2 step and the complete
pure sequential runner with every source/destination/final validation, exact keys,
limits, errors and clone/freeze behavior. Synthetic schema 3 remains test-only.
Appearance/host selections apply hot, port stays cold; saving does not prove binding.

Exact store.ts owns loadAppConfigurationDocument and openAppConfiguration plus the
whole private commit, state and pending chain. Its dependencies are model,
shared/errors, adapters/file-evidence and node:crypto, node:fs/promises, node:path.
It gains no ambient environment, clock, network, process-launch or native power.
Require ownsSingleton before I/O. Only ENOENT permits defaults. Validate the whole
migration chain before effects. Keep exact original-byte wx/0600 backup, sync/close
and equal-file EEXIST rule; retain unique wx temporary write/sync/finally-close,
rename/finally-unlink order and original error propagation. Publish memory only
after the complete commit resolves, including cleanup. Parse each save inside the
admitted pending callback and retain its rejection recovery; add no retry/rollback.

Only current interface/app-main.ts imports the store VALUE. It consumes model TYPEs,
as do interface/app-window.ts and application/app-host-management.ts. Exact
interface/app-manager.ts consumes parseAppConfiguration VALUE and AppAppearance,
AppConfiguration and AppHostSelection TYPEs; desktop/contracts/commands.ts consumes
that parser VALUE and AppConfiguration TYPE, and desktop/contracts/snapshots.ts
consumes the parser VALUE and AppConfigurationState TYPE. These are exact module VALUE/TYPE
roles, not a general symbol-level capability checker. Unknown siblings inherit no
store or I/O permission. Never add wrappers, barrels, duplicate state or queues.

Main retains startup/configuration/Quit joins and pre-await flags; a singleton
loser opens no selected configuration/data root. Quit waits admitted writes,
construction cleanup and Host close, retaining ownership/UI/retry on failure.
Host selection/cache/pending native jobs stay a separate authority. Change only
actual caller imports; introduce no new await, default deployment or native adoption.
