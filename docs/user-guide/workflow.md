# Workflow

Invoke the [Skill entry for your host](installation.md) and describe the
application and debugging task. The connection starts with no target. The
Plugin only controls an application it launches and verifies; it does not attach
to an already running browser. Data directory isolation is an explicit choice;
Chrome receives no automatic debugging-profile directory.

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

## Isolation and launch preparation

Before preparing a new launch, the Agent asks whether you want data directory
isolation, unless an applicable prior choice already answers it. None skips
isolation-support research, isolation-directory selection and cleanup questions
or actions. It does not create or delete an isolation directory.

Every new launch, in both modes and with every directory selection, still needs
application/version, documented CDP startup and read-only occupancy checks.
The Agent treats all targets as singletons for the same effective data directory.
Known same-directory or shared-namespace use blocks launch. A related running
application with uncertain directory/namespace attribution also blocks it
conservatively; incomplete inspection remains unknown and unlaunched.
A missing or new directory alone is insufficient when shared production state
or a namespace remains. Complete related-app absence can clear the generic
point-in-time gate, subject to applicable known locks, without requiring an
otherwise unavailable normal root. It does not establish isolation support.

The Agent identifies the actual executable and any required cwd/env from facts
applicable to this request. Examples and another independent request's paths do
not establish installation facts. An unresolved required value stays pending;
the Agent does not submit a concrete launch with guessed values.

For requested isolation, the Agent researches the actual application's version
through official documentation/source, read-only installed facts and applicable
verified evidence. A framework, CDP support, one directory switch or successful
launch alone does not prove which state is isolated.

- Full support proceeds to directory selection.
- Partial support explains remaining production effects and asks whether to
    accept that scope or choose none, before asking directory or cleanup questions.
- Unsupported isolation is explained and leaves the application unlaunched,
    without another choice question or automatic fallback.
- Unknown support prompts further applicable research and a report of the gaps;
    the application remains unlaunched and unknown is not reported as unsupported.

Application support and Plugin expression support are separate. An application
may isolate through cwd alone, while this Plugin binds the acquired data directory
only through args/env. Such a verified contract cannot be launched as isolated
here without an expressible binding; the Agent reports that limitation.

## Select a directory and cleanup policy

When a directory choice is needed, the Agent presents these options in order:

1. Agent freely chooses a suitable location.
2. Chrome preset isolation directory, for Chrome only.
3. You select an existing empty or nonempty directory.
4. You select an existing parent and an optional name for a new child.

Other applications omit the Chrome-only option and keep the remaining order.
Existing choices are reused; no reason or location judgment is required.
Full delegation needs no path from you: the Agent selects an existing suitable
parent and the program allocates a random `dct-` child. Named children are created
exclusively by the program from parent/name. Missing existing paths or named
collisions fail without switching operations, overwriting or choosing a fallback.

The explicit [Chrome preset](configuration.md#ports-and-data-directories) reuses
the old home-relative location only when selected. A present leaf uses existing
selection; an absent leaf uses new/parent/name `chrome-profile`. After preset
selection and the applicable cleanup choice, the Agent may prepare only absent
`.cache` and `chrome-devtools-mcp` containers. The program creates the managed
leaf. Those containers remain after leaf cleanup; none prepares no preset path.

The Agent inspects directory entries and metadata, including hidden entries,
without reading file contents. A root link/junction resolves to the actual
directory, whose absolute path is disclosed. New-parent contents do not determine
the new child's cleanup policy.

An explicit retain/delete choice is reused without asking again. Otherwise,
a user-selected existing nonempty directory, including the selected Chrome
preset, is retained in full after release; the Agent tells you its actual
absolute path without asking cleanup or offering deletion. Every other isolated
case, including an empty existing directory, delegated location or new preset,
requires a retain/delete choice before launch, without a default.
Deletion covers the whole selected actual directory and all its contents,
including pre-existing contents. The program performs the preauthorized cleanup.
Close/Keep later decides application lifetime, not directory cleanup policy.

The Plugin exposes one stdio MCP entry, `cdp-targets`. Each new target receives
its own connection and official Server child. Multiple targets can be inspected
concurrently: calls explicitly identify their connection and current session.
Creating a target preserves existing connections. The host connection remains
usable after normal Close, so you can launch another target without reconnecting.
Concurrent isolated targets need non-overlapping real data directories; see
[ports and data directories](configuration.md#ports-and-data-directories).

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

Other connections continue working. The directory follows its already selected
retain/delete policy after final release; Close alone does not imply deletion.
See [storage and cleanup](privacy.md#data-directory-storage-and-cleanup).

## Actual exit and live restart

The gateway observes the actual application's native exit from launch. Any
ordinary actual exit ends that session and removes its connection, including after
Keep/end-task. If work needs to continue after ordinary exit, explicitly start a
new target with new connection/session identities. Old page IDs and routes
cannot be reused. A closed window or failed CDP listener does not by itself
establish actual application exit.

CDP, Server or native observation failure while an app remains alive reports a
connection error. Explicit restart applies only to a still-live connection. It
retains that connection, launch arguments, working directory, leased real data
directory, cleanup policy and exact original port. It waits for old app exit and
resource disposal before creating a fresh session, router and upstream;
an occupied original port fails clearly.
Obtain fresh page IDs with `list_pages` after restart. No launch/restart or tool
replay happens automatically.

To change application launch arguments, choose normal Close, wait for it to
complete, then start with the updated settings and a fresh requestId. Optional
`mcpArgs` can replace official Server configuration during an explicitly
authorized live restart; see [configuration](configuration.md).

The directory lease spans restart: the intermediate old-app exit does not
release it. Final release waits for confirmed actual exit or evidence that no
app was created, settled native acquisition/permission waits/late creation,
no successor launch, and successful disposal of relevant resources.
Keep/end-task holds the directory until actual exit. Failed Close or observation
retains ownership. An acquired directory after failed/cancelled start or restart
uses this same barrier; failure before acquisition does not delete a directory.

Failed resource disposal after confirmed app exit is retained internally for
gateway cleanup retries and does not keep the dead session routable. Gateway
disconnect cancels dependent work and attempts resource disposal and normal
target shutdown; Keep depends on the gateway remaining alive. Failed directory
cleanup remains in the in-memory retry ledger without restoring a dead route.
External Chrome use detected before deletion retains the directory. A hard crash
or disconnect without verified app exit cannot promise future deletion. See the
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

## Directory evidence

Read the original start operation's explicit isolation metadata or selected
status configuration for the actual real path, cleanup policy and state.
States are held, retained, deleted and cleanup-failed; entry presence is included
when inspection succeeded. Evidence survives failed/cancelled startup and removal
of a dead connection. The Agent always discloses a retained actual absolute path,
including delegated locations, random children and resolved root links.
Later release/retry updates that original start metadata without changing its
terminal result/state/cursor or producing another completion notice.
Default summaries and automatic Hooks omit directory paths and raw filesystem
errors. Do not infer deletion from Close, cancellation or route removal.

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
