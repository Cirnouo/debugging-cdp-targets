# 0013 — Session ownership and actual-exit cleanup

Status: accepted for unreleased 0.1.0. Partially supersedes
[0009](0009-process-exit-hooks.md) and [0011](0011-mcp-native-lifecycle.md).
Partially superseded by the accepted design in
[0015](0015-explicit-data-directory-isolation.md) for connection-level data
directory leases across sessions; implementation is pending. The text below
records the original session ownership decision for other resources.

A target can exit while startup or an official request is blocked. Retaining a
recoverable dead session and serializing its cleanup behind that work keeps
stale routes, transports and children alive. One session owner now exists before
resource acquisition; actual application exit revokes its route and dependent
work immediately, attempts disposal of every owned resource, and removes the
connection/session even when an individual disposal fails. Failed plugin-owned
resources remain in an internal in-memory ledger for gateway cleanup retries.
This trades dead-session restart convenience for an unambiguous process lifetime
and complete ownership during partial startup and disposal races.

Windows Node children are fixed helpers, not the managed application. Actual PID,
creation time and native handle wait/events establish application exit without
process polling. Helper termination or observation failure cannot assert exit.
Normal target Close requests shutdown and continues observing actual exit with
no target deadline. Cancellation retains ownership and observation of a live app.
The 25-second operation wait bounds one response; it never expires a Close job.
Normal application Close is independent of unrelated CDP listener lifetime and
official Server disposal. Applications are never force-killed.
Direct Node application children remain unreferenced outside actual-exit waits.
Each active wait holds a shared child reference until completion or cancellation;
one cancelled waiter cannot release another waiter's reference during gateway EOF cleanup.

The official Server is a plugin-owned child with a separate disposal policy.
Closing its public SDK transport immediately rejects pending requests. Child
disposal first closes stdin, allows two seconds for EOF exit, then two seconds
after TERM, and may use KILL within a total ten-second budget. Completion requires
actual child-exit evidence. Failure retains only disposal ownership in the
ledger. These child controls do not authorize terminating the target app.

Keep/end-task retains a live target, router, upstream and lifetime observation.
Every later actual exit, active or inactive, removes that session. Retrying work
after ordinary exit uses start with new connection/session IDs. Explicit restart
of a still-live target waits for old exit and disposes old resources before
creating a new owner, router and upstream on the same connection and exact port.
The gateway refuses a busy original port and never retries launches or replays
tools automatically. Port ownership is reserved synchronously before probing,
held until actual exit or evidence that no app was created, and isolated per
gateway. A foreign listener collision after app creation cannot trigger relaunch.

Gateway disconnect gates and cancels all owners and disposes all Server, catalog
and router resources in parallel with normal target shutdown. One failure cannot
skip peer cleanup; disconnect adds no target-close deadline. Live failed-close
identity remains owned until exit or successful normal cleanup.

Status discovery and lifecycle successes use connection summaries. Selected
status opts into tool names, configuration and diagnostics; explicit toolNames
requests receive schemas only from a valid actual upstream. Enabled tools never
receive activation recipes; supported explicitly disabled tools receive complete
replacement recipes, while unsupported tools receive their reason. Failures
retain identity, phase, code and native evidence without configuration payloads.

Hooks emit independent compact events. Expected Close/restart exits are grouped
by operationId into the operation notice's exits array, superseding 0009's blanket
expected-exit silence. This includes every actual exit during restart, both the
old Target and any new Target rollback, with their own identities and cleanup
results. Pending related cleanup retains both its exit facts and its operation
notice until all related cleanup is ready for delivery. Inactive exit remains
informational; active unexpected exit may suggest a new start. Successfully
delivered terminal status/wait, terminal cancel or an identical mutation retry
acknowledges its notice. Aborted requests and nonterminal responses do not.
No pending event returns {}. Idle chats
wait for their next turn. The seven lifecycle tools, official catalog/results,
host trust controls, loopback ownership checks and immutable bundled release
requirements remain unchanged.
