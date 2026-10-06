# Workflow

Invoke the [Skill entry for your host](installation.md) and describe the
application and debugging task. The connection starts with no target. The
Plugin only controls an application it launches and verifies; it does not attach
to an already running browser. Chrome uses a dedicated debugging profile,
separate from your usual browsing profile.

## Start and inspect

For Chrome, describe the page URL and what you want to investigate. For another
CDP-capable application, provide its executable path and documented debugging
option if you know them. The Agent checks that it exposes the required
browser-level endpoint before using the official DevTools tools.

After invoking your host's Skill, a task can be as simple as:

```text
Launch a separate Chrome debugging window and open https://example.com.
Inspect the page's network requests and console errors, and summarize what you find.
```

The Plugin exposes one stdio MCP entry, `cdp-targets`. Each new target receives
its own connection and official Server child. Multiple targets can be inspected
concurrently: calls explicitly identify their connection and current session.
Creating a target preserves existing connections. The host connection remains
usable after normal Close, so you can launch another target without reconnecting.
Concurrent Chrome targets need distinct profiles; see
[ports and profiles](configuration.md#ports-and-chrome-profiles).

## Continue using a live target

Continue debugging through the same live connection. For a follow-up task, ask
the Agent to reuse a kept target while its application and gateway remain alive.
The Agent verifies the current connection/session before further official calls;
it does not implicitly select a target from another connection.

## Close or Keep

Before ending work on a target, the Agent asks **Close** or **Keep**, unless you
have already supplied that choice. There is no default.

- **Close** requests normal application shutdown and waits for actual exit, then
    removes that connection and disposes its owned resources. It does not impose
    a target-close deadline or force-kill the application. Continue operation waits
    while Close remains incomplete. If normal shutdown fails or is cancelled,
    live target identity and observation remain available for retry or manual
    normal close.
- **Keep** retains the live application, upstream and router for later tasks in
    the running gateway. The gateway continues observing actual application exit.
    Runtime state remains in memory; Keep does not create a persistent session.

Other connections continue working. Chrome profiles remain on disk after Close;
see [retained browser data](privacy.md#chrome-profile-storage).

## Actual exit and live restart

The gateway observes the actual application's native exit from launch. Any
actual exit ends that session and removes its connection, including after
Keep/end-task. If work needs to continue after ordinary exit, explicitly start a
new target with new connection/session identities. Old page IDs and routes
cannot be reused. A closed window or failed CDP listener does not by itself
establish actual application exit.

CDP, Server or native observation failure while an app remains alive reports a
connection error. Explicit restart applies only to a still-live connection. It
retains that connection, launch arguments, working directory, profile and exact
original port. It waits for old app exit and resource disposal before creating
a fresh session, router and upstream; an occupied original port fails clearly.
Obtain fresh page IDs with `list_pages` after restart. No launch/restart or tool
replay happens automatically.

To change application launch arguments, choose normal Close, wait for it to
complete, then start with the updated settings and a fresh requestId. Optional
`mcpArgs` can replace official Server configuration during an explicitly
authorized live restart; see [configuration](configuration.md).

Failed resource disposal after confirmed app exit is retained internally for
gateway cleanup retries and does not keep the dead session routable. Gateway
disconnect cancels dependent work and attempts resource disposal and normal
target shutdown; Keep depends on the gateway remaining alive. See the
[lifecycle protocol](../lifecycle-protocol.md#target-and-resource-lifetime) for
exact lifetime rules.

## Operations and waiting

Start returns an operationId immediately. The Agent calls `dct_operation_wait`
with entryId, operationId and cursor, continuing with the returned cursor until
complete. Each wait lasts up to 25 seconds and may return incomplete; this bounds
one response, not the operation or application Close. Cancelling a wait leaves
the operation running; `dct_operation_cancel` owns actual cancellation and cleanup.

Mutations use a requestId. Identical retries return the original operation;
different input cannot reuse that identifier. Cancel is idempotent for its
operation and cannot affect a newer session. Successfully delivered terminal
status/wait, terminal cancel or identical mutation retry acknowledges the
operation notice, preventing redundant Hook delivery. Aborted requests and
nonterminal responses leave the notice unread. The
[lifecycle protocol](../lifecycle-protocol.md#operations-and-delivery) defines
the complete replay and delivery rules.

## Automatic notifications

Each current host distribution provides PreToolUse, PostToolUse, UserPromptSubmit
and Stop Hooks with a three-second timeout. They call existing status and deliver
pending exit, operation and quarantine context; no event means empty JSON.
Review and enable the definitions with your
[host's standard Hook controls](installation.md). Lifecycle events require Hooks
to execute in the current host.

Enabled, authorized Hooks deliver compact events at task boundaries; idle chats
receive them on the next turn and are not woken automatically. Inactive exit is
informational; an active unexpected exit may suggest an explicitly authorized
new start. A ready Stop event requests one continuation.

Expected Close/restart exits are grouped by operationId in its operation notice,
including any new Target rollback during restart. Delivery waits until all
related cleanup results are ready. Hooks provide compact context; the full
terminal result remains available through the operation tools. See
[automatic Hook rules](../lifecycle-protocol.md#automatic-hooks) for exact output
and acknowledgement behavior.

For failures, read [troubleshooting](troubleshooting.md), or return to the
[user guide](README.md).
