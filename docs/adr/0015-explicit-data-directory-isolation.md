# 0015 — Explicit data directory isolation and connection leases

Status: accepted design for unreleased 0.1.0; runtime implementation is pending.
Supersedes the fixed Chrome profile and unconditional profile retention policy in
[0009](0009-process-exit-hooks.md), the fixed-profile assumption retained by
[0014](0014-windows-chrome-screenshot-surface.md), and the session-only resource
scope in [0013](0013-session-owned-exit-cleanup.md) for data directories. Other
session resources, native identity, screenshot composition, official forwarding
and seven-tool lifecycle rules remain governed by those decisions.

The gateway currently inserts a fixed Chrome profile when no directory argument
is supplied. That fallback makes isolation implicit and ties unrelated starts to
one directory. The approved replacement makes isolation intent, directory
selection and retention explicit, with a connection lease that survives restart.
This record defines the required design; it does not claim the runtime, installed
Skill or user guides already implement it.

## Intent and research before launch

Ask whether the user wants data directory isolation before researching isolation
support or asking directory questions. Choosing no isolation skips those steps.
Do not ask why the user wants isolation or judge their selected directory location.
There is no path denylist based on location.

If isolation is wanted, establish the application's exact identity and version
and research its startup contract through official documentation, official source,
read-only installation facts and other applicable verified evidence. A framework
name, accepted argument or successful launch alone does not prove isolation.
Determine which state moves to the directory and which production effects remain.

- Full support proceeds to directory selection.
- Partial support discloses the remaining production effects and asks whether to
    proceed with that isolation or choose no isolation.
- Unsupported isolation is explained and leaves the application unlaunched.
- Unknown support remains unknown and leaves the application unlaunched until
    evidence resolves it; uncertainty must not be reported as unsupported.

Startup research happens before connecting. Application-specific page inspection
and debugging exploration happen after the verified connection is established.
The shared Skill remains concise and application-agnostic rather than collecting
application recipes.

Directory selection may reuse an existing empty or nonempty directory, create a
named or random child under a selected parent, or be fully delegated to Agent.
Full delegation authorizes Agent to choose the parent and directory operation;
it does not imply deletion authorization. Hidden entries count when checking
emptiness. Inspect directory entries without reading their contents.

Before launch, retain a user-selected existing nonempty directory when the user
has given no explicit cleanup instruction. Inform the user of retention and its
actual absolute path without asking a cleanup question. For other selections,
obtain retain or delete-on-release unless the choice is already authorized.
There is no implicit deletion. An explicit delete-on-release choice authorizes
removal of the entire selected real directory and all its contents, including
pre-existing data; explain that scope before accepting the choice.

## Required public start contract

Every start must carry this discriminated isolation union:

```typescript
type Isolation =
    | { mode: 'none' }
    | {
        mode: 'data-dir';
        directory:
            | { kind: 'existing'; path: string }
            | { kind: 'new'; parent: string; name?: string };
        cleanup: 'retain' | 'delete-on-release';
    };
```

An existing path and a new parent are absolute. Existing selects an already
present directory and permits empty or nonempty contents. New requires an
existing parent: a supplied name selects one exclusive leaf, while an omitted
name creates a random `dct-` child through `mkdtemp`. A missing existing directory
or colliding named child fails without switching operations or selecting another
directory. None neither creates nor deletes a data directory and rejects `{dataDir}`.
An identical requestId retry remains bound to the original start operation and
must not acquire a second directory.

Agent supplies the researched application binding through the existing
structured launch args or env using `{dataDir}`. The acquired real path replaces
that placeholder as opaque data: its bytes are not expanded as environment
variables, `{port}` or another `{dataDir}`. Executable/cwd remain structured
application paths rather than data directory binding carriers. Generic binding
establishes which directory was passed, not proof that every application state
or external production effect is isolated.

Remove the implicit fixed Chrome profile. For isolated Chrome, the effective
`--user-data-dir` must identify the acquired real directory. Preserve native
Chrome ownership checks and fail closed on occupied or unverifiable profiles.
No isolation uses the caller's normal application startup contract and does not
silently select an isolation directory. Never attach to an existing target or
replace a failed selection with another profile.

## Acquisition, identity and scope

Validate structured launch, official options and applicable launch composition
before acquiring a directory. A failure before acquisition cannot authorize
directory deletion. Each acquired directory has one connection-level lease,
separate from the session owners of target, router, port and upstream resources.
Preserve acquired path and ownership evidence when creation succeeds but a later
identity/verification step fails; a failed acquisition result does not mean no
directory was acquired. Release or retry follows the same verified cleanup barrier.

Resolve a selected root symbolic link or junction to its actual directory before
binding and record that real root's identity. Delete-on-release removes that
actual directory and its contents; deleting only the selected link does not
satisfy the authorized cleanup. Links inside the root do not extend deletion to
their external targets. Retain preserves the complete real directory.

Reject concurrent claims whose canonical real paths are equal or have an
ancestor/descendant relationship. Check identity at acquisition and reverify it
before removal. Changed, replaced or unverifiable root identity fails closed and
retains cleanup ownership; permission to delete one directory cannot transfer to
another directory that later occupies the same path. These checks protect the
selected object without imposing a location-based path denylist.

## Connection lifetime and cancellation

The directory lease spans every session of one connection. Explicit restart
keeps it while the old app exits and resources are disposed, and the replacement
app uses the same real directory. An intermediate restart exit never releases
the lease. A final failed or cancelled restart releases it only when no live or
pending application or successor can still use it.

Keep/end-task retains the lease, application, upstream and observation until
actual application exit. Normal Close follows the existing actual-exit rules.
Failed observation, failed Close and rollback with a live app retain ownership.
Never force-kill an application to satisfy cleanup.

Release requires evidence that no live application, pending native acquisition,
permission wait, late `onCreated` callback, successor launch or relevant read/write
resource remains. A cancellation signal or terminated helper alone is not such
evidence. Startup ownership covers pending acquisition before an actual app
identity arrives; late creation must transfer into owned normal Close/observation
and keep the directory leased until actual exit. An acquired directory can be
released after failed or cancelled startup only when this same barrier is met.

Retain releases the claim while keeping the directory. Delete-on-release applies
the already authorized whole-directory cleanup at release. Failed disposal stays
in the existing in-memory cleanup ledger even after the dead route is removed.
A successful retry completes cleanup without restoring a connection/session or
restarting an application. Root identity failure also retains the claim/evidence
so a concurrent launch cannot treat incomplete disposal as a clean release.

A handled gateway disconnect attempts normal application Close and owned cleanup.
A hard crash, or disconnect without verified app exit, cannot guarantee later
deletion. No daemon, persistent session state or scan of old directories/processes
is added to recover that cleanup. A live application may require the user to
finish normal Close before the selected deletion can occur.

## Evidence and disclosure

The real directory path, cleanup policy and cleanup state belong only in explicit
operation metadata and selected configuration. Preserve acquired-directory
evidence even when startup fails or is cancelled. Later disposal or retry updates
the original start operation's directory metadata without changing its terminal
state/result or producing a second completion notice.

Default connection summaries, lifecycle success/failure summaries and automatic
Hooks contain no data directory paths or raw filesystem errors. Compact notices
retain the existing bounded identity/phase/code contract. Agent explicitly reads
operation metadata or selected configuration to report the retained actual
absolute path, including after failed or cancelled launch. Do not lose that
evidence by retiring the route or replacing a session.

## Trade-offs and implementation gates

The required union deliberately changes start callers rather than preserving an
implicit fallback. A connection lease adds a distinct lifetime so restart cannot
delete data between sessions. Whole-directory cleanup permits deliberate reuse
of existing data but requires clear authorization and verified release; deletion
is not limited to files created by the current launch. Transient ownership keeps
the gateway architecture small and makes hard-crash cleanup a stated limit.

Implement domain changes test-first. Verify missing/colliding operations, opaque
binding, root links, overlap, changed identity, restart and late-acquisition races,
cleanup retry and path-free Hooks. Real Chrome acceptance on Linux/macOS must
verify effective binding, same-directory restart and final normal cleanup.
Contributor rules can adopt this design now; installed instructions, user guides
and completion claims must follow actual implementation and verification.
