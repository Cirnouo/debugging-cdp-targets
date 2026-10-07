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

## Data directory storage and cleanup

Data directory isolation is explicit and depends on the researched application/
version contract. A selected directory does not by itself guarantee that every
production effect, credential store or external service is isolated.
None uses the application's normal startup contract and creates/deletes no
isolation directory. It never selects the Chrome preset.

Chrome's old location remains available only as an explicit isolation choice:

| Storage | Windows | Linux/macOS |
| --- | --- | --- |
| Explicit Chrome preset isolation directory | `%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile` | `~/.cache/chrome-devtools-mcp/chrome-profile` |

The Agent resolves the actual absolute home and directory. Other choices may
delegate a suitable location, reuse an existing empty/nonempty directory or create
a named/random child under an existing parent. When listing the complete Chrome
menu, the order is Agent choice, Chrome preset, existing directory, new child.
See [directory choices](workflow.md#select-a-directory-and-cleanup-policy).

A user-selected existing nonempty directory, including the preset, is retained
in full when no explicit cleanup choice exists. The Agent informs its actual
absolute path without a cleanup question or deletion offer. Other isolated
cases need retain/delete before launch without a default; prior choices are reused.
Delete-on-release authorizes removal of the entire selected actual directory,
including all pre-existing contents. Retain preserves the entire directory.
Close/Keep is an application decision and does not change that selected policy.

The program acquires the existing real directory or creates one exclusive leaf.
A selected root link/junction resolves to its real object; deletion removes that
actual directory, while child links do not extend deletion to external targets.
Changed or unverifiable root identity prevents removal and retains cleanup
ownership. Concurrent equal or ancestor/descendant real claims are rejected.
For an explicitly selected missing Chrome preset, Agent may prepare only absent
`.cache` and `chrome-devtools-mcp` containers after cleanup selection.
The program creates/cleans `chrome-profile`; those containers remain afterward.
Generic new selections still require an existing parent.

The connection directory lease spans session restart and Keep/end-task through
actual application exit. Deletion waits until no live/unconfirmed app, pending
native acquisition/permission wait/late creation, successor launch or relevant
resource remains. Failed Close/observation/resource disposal retains ownership.
External Chrome occupancy detected during failed startup or before cleanup also
prevents deletion. Failed cleanup remains in an in-memory retry ledger without
restoring a dead route. Hard gateway crash or disconnect without verified exit
cannot promise later deletion; there is no daemon, persistence or old-state scan.

Actual path, policy and state appear only in explicit original start operation
metadata and selected configuration. State is held, retained, deleted or
cleanup-failed; entry presence appears when inspection succeeded.
Original start evidence survives failed/cancelled startup and route removal.
Later release/retry updates that metadata without another completion notice or
changing the original terminal result/state/error/cursor. The Agent discloses
retained actual absolute paths, including delegated/random/resolved-link paths.
Default summaries and automatic Hooks omit paths and raw filesystem errors.
Reading entries/metadata for directory decisions does not require reading contents.

Upgrades leave older caches, unselected existing profiles, user configuration and
global Skills in place. See [configuration](configuration.md#ports-and-data-directories)
for binding and occupancy enforcement limits.

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
