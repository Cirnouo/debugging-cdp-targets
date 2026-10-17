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

## Fixed user questions

All Plugin-directed questions use fixed Chinese and English templates in the
[shared Skill](../../packaging/shared/skills/debugging-cdp-targets/SKILL.md#canonical-user-questions).
The Agent uses the established conversation language and substitutes only the
template's declared facts. Titles, questions, option labels, explanations and
order remain fixed. Agent, User and Plugin name the responsible roles explicitly.
For another application, only the Chrome preset directory option is omitted.
Full Agent delegation requires no User-supplied path: the Agent chooses an
existing parent and the Plugin creates a random child.

Existing applicable choices are reused; fixed wording does not transfer another
independent task's paths or authorization. Host preselection is not consent.
If a host question control cannot carry the complete template, the Agent presents
the complete text rather than dropping options. A future random child is described
by its existing parent and allocation method before launch; its actual path is
reported only after acquisition.

The same verified event selects the same template whether received through
a tool error or an explicit status query. Live connection recovery asks Restart or
Close; confirmed active target exit asks about a new start in the current chat.
Inactive/expected exits, unsupported/unknown isolation, occupancy blocks and
continued Close waits do not introduce extra decisions. Missing information,
ambiguous target/cancellation intent, explicit input correction and unavailable
native file pickers have separate templates; the Agent investigates discoverable
facts before asking for necessary inputs.

Tool-enablement questions show the complete proposed replacement MCP argument
array, including workspace access. Application argument changes show a complete
Close-to-start proposal; Close must succeed before renewed launch checks and new
start. An old directory deleted under its established policy is not assumed to
remain available for the successor. Declining a proposal is not a Keep decision.

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
3. User selects an existing empty or nonempty directory directly as the isolation directory.
4. User selects an existing parent; the Plugin creates an isolation child with a
    random name that does not conflict with existing child directories.

Other applications omit the Chrome-only option and keep the remaining order.
Existing choices are reused; no reason or location judgment is required.
Full delegation needs no path from you: the Agent selects an existing suitable
parent and the program allocates a random `dct-` child. An already explicit named-new
path remains supported; no optional name is requested. Named children are created
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

The thin Plugin connects one direct HTTP MCP entry, `cdp-targets`, to the running
App. Register once and explicitly supply its private registrationBearer on every
owned call. Official _dct also contains current connectionId/sessionId;
reconnecting never creates a target or implicitly selects a registration.
Each new target receives
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
Keep. If work needs to continue after ordinary exit, explicitly start a
new target with new connection/session identities. Old page IDs and routes
cannot be reused. A closed window or failed CDP listener does not by itself
establish actual application exit.

CDP, Server or native observation failure while an app remains alive reports a
connection error. Explicit restart selects target, official or both using the
original immutable launch, resolved environment, official options and roots. The
logical connection, router and leased directory stay stable. Target-only restart
waits for actual old-target exit and native resources while retaining the same
official Server. Official-only preserves the target. Both replaces each side once.
Every scope issues a fresh session and requires fresh `list_pages` evidence.
Fixed ports remain fixed and refuse collisions; automatic port policy may select
another verified free port. No launch/restart or tool replay happens automatically.

Changing application arguments, environment or mcpArgs requires completed normal
Close and a new start with a fresh requestId. Restart scope is always required.

The directory lease spans restart: the intermediate old-app exit does not
release it. Final release waits for confirmed actual exit or evidence that no
app was created, settled native acquisition/permission waits/late creation,
no successor launch, and successful disposal of relevant resources.
Keep holds the directory until actual exit. Failed Close or observation
retains ownership. An acquired directory after failed/cancelled start or restart
uses this same barrier; failure before acquisition does not delete a directory.

Failed resource disposal after confirmed app exit is retained internally for
App cleanup retries and does not keep the dead session routable. Host or MCP
disconnect never closes targets; normal App Quit cancels admission and attempts
resource disposal and normal target shutdown. Keep depends on the App remaining
alive. Failed directory
cleanup remains in the in-memory retry ledger without restoring a dead route.
External Chrome use detected before deletion retains the directory. A hard crash
or disconnect without verified app exit cannot promise future deletion. See the
[lifecycle protocol](../lifecycle-protocol.md#target-and-resource-lifetime) for
exact lifetime rules.

## Operations and waiting

Start returns an operationId immediately. The Agent calls `dct_operation_wait`
with registrationBearer, operationId and cursor, continuing with the returned cursor until
complete. Each wait lasts up to 25 seconds and may return incomplete; this bounds
one response, not the operation or application Close. Cancelling a wait leaves
the operation running; `dct_operation_cancel` owns actual cancellation and cleanup.

Mutations use a requestId. Identical retries return the original operation;
different input cannot reuse that identifier. Cancel is idempotent for its
operation and cannot affect a newer session. Terminal results are read explicitly;
there is no automatic notification queue or acknowledgment. The
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
terminal result/state/cursor or producing another operation.
Default summaries omit directory paths and raw filesystem
errors. Do not infer deletion from Close, cancellation or route removal.

## Reconnect and ownership

A registration owns resources independently of a conversation, socket or MCP
session. Retain its bearer in the authorized task context and reconnect with
that same bearer; do not repeat start. Status cannot recover a lost bearer. A new
registration does not acquire the old owner's targets. The App's normal Quit
normally closes its owned resources; the minimal manager currently does not
expose per-connection transfer controls.

Read status or the original operation for current facts. There are no automatic
host Hooks, task-active flags or end-task tool. Accepted start responses can
precede roots admission: original facilities remain until admission settles or
the originating client/session disconnects. See
[HTTP request lifetime](../app-runtime.md#request-lifetime), including best-effort
remote roots cancellation after an SSE response has ended.

For failures, read [troubleshooting](troubleshooting.md), or return to the
[user guide](README.md).
