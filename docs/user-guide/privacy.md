# Data, privacy and dependency trust

## Runtime state and network access

Target identity, launch settings and operation events are held in memory.
Windows elevation uses an authenticated one-shot helper pipe; application data
never appears in its command line. The Plugin does not log launch commands,
page contents, cookies, network or console data, secrets, or tool calls.

The official Server's usage statistics and CrUX lookups are disabled by default.
Debugging tools and the pages you open can still make network requests; these
defaults are not a guarantee that all upstream tools work offline. See
[configuration](configuration.md#official-server-settings) for explicit overrides.

## Chrome profile storage

Chrome retains its debugging profile separately from your usual browsing profile:

| Storage | Windows | Linux/macOS |
| --- | --- | --- |
| Default Chrome debugging profile | `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile` | `~/.cache/chrome-devtools-mcp/chrome-profile` |

The Chrome profile retains browser data, including cookies and browsing state.
Starts and live restarts reuse this fixed default directory unless you explicitly
select another `--user-data-dir`. Occupied or unverifiable profiles fail clearly;
concurrent Chrome targets need distinct profile directories. Profiles are
retained after Close for inspection.

Older npm/package caches are no longer used; upgrades leave them and existing
profiles, user configuration and global Skills in place. See
[ports and profiles](configuration.md#ports-and-chrome-profiles) for launch behavior.

## Local debugging boundary

CDP provides powerful access to the application being debugged. Both the
Plugin's CDP transport and the target's debugging endpoint must listen on
loopback only. Never expose or tunnel these ports to a network. Loopback does
not protect against malicious software running as your user.

The Plugin launches and verifies its own targets and does not take over existing
applications. Close uses normal application shutdown, with no application force
kill. See [workflow](workflow.md) for ownership and actual-exit behavior and
[SECURITY.md](../../SECURITY.md) to report a suspected vulnerability privately.

## Bundled official package integrity

The official Server is delivered at `<plugin-root>/dist/official-server/`.
Every published file is verified before each Server launch. Missing or changed
files require reinstalling the Plugin, or rebuilding it in a prepared contributor
checkout. Runtime does not fetch replacement packages. Only the official child's
environment disables its automatic update check.

## Dependency audit scope

Build-time checks audit dependencies for known vulnerabilities and verify npm
registry signatures. See the [supply-chain policy](../policies/supply-chain.md)
for details. Both the build and isolated audit use the reviewed release and
committed locks. Every published file is bound to maintained SHA-256 evidence.

The release embeds vendor libraries outside its npm dependency graph: graph
audits do not establish vulnerability coverage for those embedded libraries.
Their original inventory and license notices are preserved. The Plugin does
not perform a runtime vulnerability audit.

Return to the [user guide](README.md).
