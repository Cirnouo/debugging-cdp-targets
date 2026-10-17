# Recovery and events

Before restarting a live connection, disposing resources, retrying cleanup or
selecting operation status or handling modern request input, read this reference. Follow the
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
without changing its terminal state/result or creating another operation.
Do not infer deletion from Close, cancellation or route removal; read explicit
directory evidence.

## Live restart

`dct_connection_restart` requires registrationBearer, connectionId, sessionId and requestId;
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

## Explicit operation and client lifetime

Use the registration bearer explicitly with operation status, wait or cancel.
operationId status cannot combine connectionId, toolNames or include. A complete
wait or identical request retry returns owned evidence; it does not acknowledge a
notice queue. Registrations, jobs and resources live only in App memory.

Legacy accepted lifecycle responses can precede the original roots admission. A normal
HTTP response ending is not client disconnect; original request facilities remain
attached until admission settles or that client/session actually disconnects.
Explicit operation cancel or App cleanup ends local admission before new resource
acquisition. SDK2.2 cancellation after the originating SSE has ended is best effort
on the wire: a remote roots handler may finish late, but its late reply cannot
acquire resources or revive the operation. Never replace that context with another
client, replay start, or interpret a missing cancellation notification as success.

## Modern request input

The same App endpoint supports modern 2026-07-28 and sessionful legacy clients
under host defaults. Modern advertised roots are resolved before start acceptance;
the accepted operation retains that immutable snapshot. Unsupported roots are empty.

For standard `input_required`, retain the original ordinary tool arguments,
registration bearer, route and domain requestId. Answer only the requested input
key with a bare roots/form result, echo the signed requestState and use a fresh
wire request id. The host SDK normally handles this exchange. A form continuation
resumes the same actual official execution; never repeat the official tool to
supply an answer. Accepted content must satisfy the pending form, and decline or
cancel stays that outcome. Missing/dropped input can reissue the current round;
changed arguments/routes/owners, consumed rounds and capability downgrade fail.

The bounded input flow allows at most eight distinct form rounds within the
original 600-second deadline beginning with its first form. Reissuing input does
not renew that deadline. An expired or genuinely detached holder is unavailable;
it provides no result archive or replay permission. Normal intermediate response
completion preserves the pending invocation. True cancellation/disconnection or
expiry detaches its facilities while the actual execution remains busy until it
really settles, preserving healthy targets/upstreams and directory ownership.

Progress is optional and belongs only to the currently active response/token;
it stops between rounds, after completion and after detach. It cannot replace
`dct_operation_wait`, status or explicit results. Native host background tasks do
not establish MCP Tasks. There is no connection-state Resource or automatic chat
injection workflow. Continue the existing Close/Keep and explicit recovery rules.

Keep leaves target/upstream/ownership intact. Close and normal App Quit clean
resources through actual-exit and disposal barriers. A client/chat/socket close
does not request App cleanup. Unexpected actual target exit retires the route;
observe explicit status/errors and obtain authorization before any new start.
