# Recovery and events

Before restarting a live connection, disposing resources or retrying cleanup,
reviewing/enabling host Hooks, interpreting operation/exit notices or their
acknowledgment, or selecting operation status, read this reference. Follow the
[main recovery and task-completion rules](../SKILL.md#errors-native-dialogs-and-task-completion)
and [directory lifetime/evidence rules](../SKILL.md#directory-lifetime-and-evidence).
Use the question contract/current locale before a needed question.

## Disposal and cleanup evidence

An observation failure, failed/cancelled Close or failed resource disposal
retains ownership.
Never force-kill an application to satisfy cleanup. Failed disposal stays in the
in-memory cleanup ledger; a successful retry completes directory cleanup without
restoring the route or restarting/replaying. Root identity is reverified before
deletion; replacement or unverifiable identity retains cleanup ownership.
If external Chrome occupancy is detected during failed startup or before cleanup,
retain the directory and report the explicit cleanup evidence rather than deleting
data another running instance may use.
Child links do not extend deletion to their external targets. A hard gateway
crash, or disconnect without verified app exit, cannot guarantee future deletion.

Later disposal/retry updates the original start operation's directory metadata
without changing its terminal state/result or producing another completion notice.
Do not infer deletion from Close, cancellation or route removal; read explicit
directory evidence.

## Live restart

`dct_connection_restart` requires entryId, connectionId, sessionId and requestId;
pass explicit scope target, official or both. Every scope uses the immutable
original effective launch/environment, official configuration and roots. Target
scope replaces only the target after actual exit and native resource release;
official scope retains that target; both replaces each side once. The logical
router/directory stay stable and public session identity changes after either side.
Explicit fixed ports refuse collisions; automatic port policy can select another
verified free port without changing unrelated launch bytes. Obtain fresh page IDs
with list_pages; old operations cannot cancel a successor session. Configuration
changes require completed Close and a new start.

Cancelling a client response wait does not cancel its actual official execution
or make its connection idle. Keep original progress/elicitation context; never
route a detached request to another client. A failed final cleanup retains live
ownership and observation, denies new work and requires an explicit cleanup retry.

## Hooks and operation notices

Enabled, authorized host Hooks deliver compact operation notices, connection
errors and exit events at task boundaries. Review and enable the four definitions
using the current host's Plugin/Hook controls, described in the installed Plugin guide.
Idle chats receive events next turn; they are not
woken automatically. An active unexpected exit reports the removed session and
may suggest an explicitly authorized new start; inactive exit is informational.
Expected Close/restart exits belong to the operation notice's exits array, grouped
by operationId. It retains every related actual exit and cleanup result, including
old Target exit and new Target rollback during restart. Delivery may wait until
all related cleanup is ready; pending cleanup keeps both notice and exit facts
unread. Successfully reading a terminal result through operation status, complete
wait, cancel of an already terminal operation or an identical mutation retry
acknowledges that notice. Aborted requests and nonterminal responses leave it
unread. Hooks never embed complete results, errors, configuration, diagnostics,
schemas, tool names/counts or recipes. With no pending event, Hooks return {}.
Keep other connections usable. hookEventName must be the sole argument and is
reserved for automatic Hooks. operationId status cannot combine connectionId,
toolNames or include. All runtime identities and operation queues stay in memory.
