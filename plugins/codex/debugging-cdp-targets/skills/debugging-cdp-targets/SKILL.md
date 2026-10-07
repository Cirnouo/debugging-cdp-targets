---
name: debugging-cdp-targets
description: Use when an Agent needs to inspect a local Chrome browser or another explicitly CDP-capable application's browser-level renderer through the official Chrome DevTools MCP tools.
license: MIT
metadata:
    version: "0.1.0"
---

# Debugging CDP targets

Use the cdp-targets MCP gateway. Start with `dct_connection_status({})` to
discover entryId and connection summaries. Each newly launched target has independent
connectionId, sessionId and official MCP. Never attach to an existing application.
A framework name alone does not establish browser-level CDP compatibility.

## Isolation intent before launch

Before preparing a new launch, ask whether the user wants data directory
isolation, unless an applicable prior choice already answers it. Reuse the user's
choices; do not ask for reasons. An isolation choice starts research, not a promise
that the application can isolate its state.

If the choice is **none**, skip isolation research, isolation-directory selection,
contents inspection and cleanup questions/actions. Do not use the Chrome preset.
Continue the necessary application-launch and browser-level CDP checks, then use
`isolation: { "mode": "none" }`. Never silently add a data directory to make a
non-isolated launch work; report the specific application's debugging limitation.

If isolation is requested, establish the actual application and version before
launch. Research its startup contract through official documentation/source,
read-only installed information and applicable verified evidence. Determine what
state moves to the directory and what production effects remain. A framework
name, CDP support, one directory switch or successful launch alone is insufficient.
Classify the evidence before asking directory or cleanup questions:

- **Full support:** continue to directory selection.
- **Partial support:** explain the remaining production effects and ask whether
    to accept this isolation or choose none. Wait for that decision.
- **Unsupported:** inform the user of the established limitation and leave the
    application unlaunched. Do not add another choice question or select a fallback.
- **Unknown:** continue applicable research and report the evidence gaps.
    Keep the application unlaunched; missing evidence does not mean unsupported.

Distinguish application capability from a Plugin launch-contract limitation.
For example, an application may fully isolate state only through its working
directory, while this Plugin binds `{dataDir}` only in args/env, not cwd.
Report that expression limitation and leave it unlaunched without inventing an
argument/environment carrier or falling back to none.

## Effective directory and occupancy

For both isolation modes, establish the actual application/version and documented
CDP startup from applicable official documentation/source and read-only
installation/OS evidence. Identify the effective profile/state root when needed
for directory binding or attribution of related use; account for branding,
channel, launch environment, wrappers and applicable policy overrides. These
facts concern the directory actually used, not whether the app supports a
singleton API. For launch decisions, treat every target as a singleton for its
same effective data directory; do not research singleton capability or waive
occupancy checks because an application supports multiple instances. This common
startup gate applies to none and data-dir, independently of isolation intent and
existing/preset/new/delegated selection. None still skips isolation-support
research and isolation-directory/cleanup choices.

Before every start, inspect bounded related-process/native-identity evidence
against the actual executable, effective directory and applicable shared namespace.
Distinguish verified separate use from these blocking cases:

- Known same-directory or shared-namespace use: inform the user and remain unlaunched.
- A related running application whose directory/namespace attribution is uncertain:
    conservatively inform the user and remain unlaunched.
- Incomplete inspection or unverifiable occupancy evidence: report the evidence
    gap and remain unlaunched.

Complete evidence of no related application can clear this point-in-time gate,
subject to applicable known native lock evidence. A missing or newly allocated
directory alone does not clear it when shared production state or a namespace
remains. Never call native launch to test availability.
Do not label occupied-or-unverifiable evidence as a positively identified running
Chrome process. Do not attach, remove locks, send singleton notifications or close
an existing instance, and do not silently select another profile.

For Chrome none, establish the normal profile actually used by the requested launch.
The Plugin preserves supplied argv without injecting a preset. Where proven
equivalent, Agent may explicitly bind that SAME normal root through a canonical
`--user-data-dir` in existing launch args; none still has no isolation lease or
directory cleanup. When exact omitted-default argv is required, preserve that
form and perform the known normal-profile occupancy check before start. The current
runtime cannot independently resolve an omitted default across installation,
channel, policy and environment variations; it enforces known explicit carriers.
An argv match alone cannot establish the effective root when policy can override
it. See [Chromium's data-directory documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md)
for research entry points; verify evidence for the installed version.

For generic-cdp, Agent performs this common gate using bounded related-process/
native-identity evidence, not guessed Chrome lock markers. Complete related-app
absence can clear the generic occupancy gate without resolving an otherwise
unavailable normal root; it does not prove isolation support or the selected
directory binding. Mere absence of application-name matches is insufficient.
The current generic runtime's post-launch process/listener/endpoint verification
does not replace the preflight. Chrome retains its known explicit-root native
lock guard; omitted-default resolution has the limit described above. There is
no universal data-directory flag, guessed default or blanket application-name
inference. A framework or multi-instance capability does not prove occupancy.

## Directory and cleanup choices

Once full support or the accepted partial scope is established, reuse any
applicable directory choice. When a choice is still needed, present these options
in this order:

1. Agent freely chooses a suitable location.
2. Chrome preset isolation directory, for Chrome only.
3. User selects an existing empty or nonempty directory.
4. User selects an existing parent and an optional name for a new child.

For another application, omit the Chrome-only option and keep the remaining order.
The Chrome preset is an explicit isolation-directory choice at
`%USERPROFILE%/.cache/chrome-devtools-mcp/chrome-profile` on Windows and
`~/.cache/chrome-devtools-mcp/chrome-profile` on Linux/macOS. Resolve it to the
actual absolute location. Never use it as an automatic default or in none mode.
If the selected preset already exists, pass an existing-directory selection;
if absent, pass a named new selection with name `chrome-profile` and its absolute
`chrome-devtools-mcp` parent. After explicit preset selection and the applicable
cleanup choice, Agent may create only absent `.cache` and `chrome-devtools-mcp`
container ancestors, then verify the parent exists. The program exclusively
creates/acquires/binds/cleans the `chrome-profile` leaf; never precreate that leaf.
Existing ancestor files, access/identity failures or a leaf race stop the selection
without overwrite, operation switching or fallback. Container ancestors remain
after selected-leaf cleanup; disclose that scope once. This bounded preset
preparation does not change the existing-parent requirement for generic selections.
None prepares no preset path. The selected preset's existence and contents
determine cleanup exactly as for a user-selected
directory: existing nonempty retains without a cleanup question unless the user
already chose otherwise; existing empty or new requires a retain/delete choice
before launch when none has been supplied.

Full delegation needs no user-specified path: choose a suitable existing parent
and let the program allocate a random child. Do not require a reason, judge
directory location or impose a location denylist.

Existing selection must already exist. Inspect entries and metadata, including
hidden entries, without reading file contents. A selected root link/junction
resolves to its actual directory; disclose that real absolute path.
For a new directory, the parent must exist. Pass the parent and optional leaf
name to start; an exact requested new path becomes its parent plus leaf.
An omitted name lets the program create a random `dct-` child. Do not precreate
the child. A missing existing path or colliding named child fails without
switching directory operations or choosing another path. The new parent's
contents do not determine the new child's cleanup policy.

Before launch, reuse an explicit retain/delete choice without asking again.
If no cleanup choice exists, apply the matching case:

- **User-selected existing nonempty directory**, including the selected Chrome
    preset: use retain and inform the user that the whole directory will remain
    after release, with its actual absolute path. Do not ask a cleanup question
    or proactively offer deletion.
- **Every other isolated selection**, including an existing empty directory and
    Agent-delegated location or empty/new Chrome preset: ask retain or delete before
    launch, with no default.

Explain that delete-on-release removes the whole selected actual directory and
all its contents, including pre-existing contents. Retain preserves it all.
Location delegation alone does not choose cleanup. The program owns managed-leaf
creation and preauthorized cleanup; do not add Agent-side leaf mkdir or a later
manual deletion step. Only the explicit preset's bounded container preparation
described above is permitted.
Close/Keep is a separate application decision, not another directory-cleanup choice.

## Start and wait

Resolve the actual executable and any required cwd/env from supplied applicable
authorization or observed read-only installation/startup facts for this request.
Another independent request's or example's executable/path is not evidence for
this launch. Missing values stay placeholders or pending evidence in proposals;
do not submit a concrete start until the required launch values are resolved.

Every `dct_connection_start` requires a fresh requestId, structured launch and
the following explicit `isolation` union:

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

Existing paths and new parents are absolute. Omit name for program-owned random
allocation; supply a leaf for exclusive named creation. Set cleanup to the chosen
policy before start.

Agent supplies the researched application binding in existing launch args or env
values through `{dataDir}`. This placeholder is forbidden in none mode and in
executable/cwd/environment keys. The acquired real path is opaque: its bytes are
not expanded again as environment variables, `{port}` or another `{dataDir}`.
Binding establishes the passed directory, not proof that all application state
or production effects are isolated.

After verifying Chrome's applicable contract and obtaining the parent and retain
choice, a start can use:

```json
{
    "entryId": "<entry-uuid>",
    "requestId": "chrome-start-1",
    "targetKind": "chrome",
    "isolation": {
        "mode": "data-dir",
        "directory": { "kind": "new", "parent": "C:/Work" },
        "cleanup": "retain"
    },
    "launch": {
        "executable": "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "args": ["--remote-debugging-port={port}", "--user-data-dir={dataDir}"],
        "cwd": "C:/Work",
        "env": {}
    },
    "mcpArgs": ["--workspace", "C:/Work"]
}
```

Use `targetKind: "chrome"` for Chrome; it has no fixed profile fallback.
For isolated Chrome, the effective `--user-data-dir` must identify the acquired
real directory. Occupied or unverifiable native profiles fail clearly; never
take over another instance. Concurrent isolated selections cannot claim equal
or ancestor/descendant real directories.

Regular Chrome 136+ ignores `--remote-debugging-port` and
`--remote-debugging-pipe` for its default data directory and requires a
non-standard `--user-data-dir`; Chrome for Testing retains the earlier behavior.
See [Chrome's remote-debugging change](https://developer.chrome.com/blog/remote-debugging-port).
If a none choice meets that limitation, report it without silently authorizing
isolation and leave unlaunched even if the normal profile is free. This is CDP
startup compatibility research, not isolation-support research. Other brands and
applications need their own verified launch/CDP contract.

Use `targetKind: "generic-cdp"` for another explicitly compatible application,
adapting its documented debugging carrier and, for isolation, its researched
data-directory binding.
`{port}` works in args/env. The Plugin detects Windows elevation requirements
and launches the actual app with its arguments, cwd and environment. Windows
controls authorization prompts. Use this native capability; Agents need no
registry inspection, privilege diagnosis, startup wrapper or launch script.

Start returns an operationId immediately. Call `dct_operation_wait` with
`{ "entryId": "<entry-uuid>", "operationId": "<operation-uuid>", "cursor": 0 }`,
then use its returned cursor until complete. Each wait lasts up to 25 seconds;
an incomplete response does not expire the operation. Continue with its cursor,
including while normal application Close is still waiting for actual exit.
A cancelled wait leaves the operation running;
`dct_operation_cancel` explicitly cancels it and reports cleanup or retained
identity. Retrying the same requestId and identical input returns the same
operation and does not acquire another directory; a new intent needs a new requestId.

## Directory lifetime and evidence

A connection owns its directory lease across session restart. Restart uses the
same real directory; the intermediate old-app exit does not release it.
Keep/end-task retains the directory lease and live app/upstream until actual exit.
Final release waits until no live application, pending native acquisition,
permission wait, late app creation, successor launch or relevant read/write
resource can still use the directory. Failed/cancelled startup or restart releases
an acquired directory only after that same barrier. Failure before acquisition
does not delete a directory.

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

Read the original start operation's explicit `isolation` metadata or selected
status `include: ["configuration"]` for the actual path, cleanup policy and state.
This evidence remains available after failed/cancelled startup. For a retained
directory or cleanup that has not completed, tell the user its actual absolute
path, policy and state, including Agent-selected, random-child and resolved-link
paths. Default summaries and automatic Hooks omit paths and raw filesystem errors.

Later disposal/retry updates the original start operation's directory metadata
without changing its terminal state/result or producing another completion notice.
Do not infer deletion from Close, cancellation or route removal; read explicit
directory evidence.

## Tool availability and routing

The global catalog is the complete official catalog, not the enabled tools of
every connection. Start/wait lifecycle results are summaries. Query status with
entryId and connectionId for enabledTools names and upstreamStatus. Query
`dct_connection_status` with entryId, connectionId and
`toolNames: ["click_at", "evaluate_script"]` for exact input schemas and conditions.
Before launch, omit connectionId to query configuration requirements. Exact
schemas require a connected, valid actual upstream; disconnected/quarantined
connections provide requirements only. Request selected
`include: ["configuration"]` for mcpArgs/workspace sources or
`include: ["diagnostics"]` for bounded diagnostics; includes can combine with
toolNames. Do not request configuration, schemas or diagnostics unless needed.

For example, click_at needs experimentalVision=true with its other conditions.
Supported explicitly disabled tools and TOOL_NOT_ENABLED include missing
conditions and complete replacement suggestedMcpArgs. Enabled tools have no
activation recipe; unsupported tools provide a reason without a recipe.
Use those only in an explicitly authorized start/restart; the gateway never
silently enables tools. Slim connections retain their actual slim tool names;
the global catalog remains full. Working directory does not grant file access:
use official `--workspace` directories and explicitly include status configuration
when inspecting workspace sources.

Every official call needs `_dct: { connectionId, sessionId }`. The gateway
removes only this routing field and preserves original arguments/results.
After start/restart, obtain fresh page IDs with list_pages for that route.

Chrome can open `chrome://version/` in its native window. The delivered official
Server 1.10.1 rejects it in `new_page`/`navigate_page` and filters it from
`list_pages`/`select_page`, including when opened at startup. Do not use official
tools to probe it or assume they can read its profile path. For the managed
lease path, read explicit operation isolation metadata or selected configuration;
establish application startup/binding through applicable official documentation/
source and read-only prelaunch evidence. Keep user browser inspection through
routed official tools; do not bypass this restriction with raw HTTP/CDP or custom
tools. Native profile probes are separately authorized instrumentation for
controlled acceptance fixtures.

For a default connection's page, evaluate_script uses:

```json
{
    "_dct": { "connectionId": "<connection-uuid>", "sessionId": "<session-uuid>" },
    "pageId": 1,
    "function": "() => document.title"
}
```

Use the selected connection's exact schema. For default navigate_page, navigation
uses type="url" and url plus its pageId; do not copy parameters between differently
named official tools or configuration variants.

## Conditional minimized screenshot compatibility

On Windows, `targetKind: "chrome"` automatically receives one bare
`CDPScreenshotNewSurface` in application argv. Use the ordinary launch args;
manual feature insertion and a screenshot foreground/minimize checklist are
unnecessary. Normal user window switching/minimizing is supported usage.
The Plugin adds no focus or window manipulation. This is a Chromium application
feature, not an MCP/CDP option or `mcpArgs` setting.

The fixed rule preserves valid unrelated ASCII feature/parameter bytes and the
positional tail after exact `--`. Explicit target disable, repeated/decorated
target, ambiguous/duplicate/separate-value switches, padded effective boundaries,
single-argument forms, non-ASCII values and malformed enable entries fail before
data directory acquisition/spawn. For example, `Other:one/two:three/four` invalidates
the whole enable list: report it and obtain an explicit correction; never append
the target to that list or silently remove a disable. See
[the feature input contract](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/adr/0014-windows-chrome-screenshot-surface.md#feature-input-contract)
for exact syntax and preserved valid parameter forms.

`generic-cdp` and other platforms receive no screenshot preset. Only for an
independently confirmed application argv carrier, a new isolated launch may use
`--enable-features=CDPScreenshotNewSurface` before exact `--`: add it to one valid
canonical enable list, or keep one bare occurrence. Preserve valid unrelated
entries and report the same conflicts. A framework name proves no support;
do not apply this recipe to an unverified WebView2 environment contract or change
personal profiles/config. Verify fresh image pixels in the intended native state.

Restart keeps exact composed argv. To change it, use an existing Close choice or
obtain it, wait for normal Close, then start with updated args/fresh requestId
and use new connection/session/page IDs. Official tools, transparent routing,
the 60-second timeout, quarantine and explicit recovery remain unchanged.
Never focus, replay or restart implicitly. The
[dated comparison](https://github.com/Cirnouo/debugging-cdp-targets/blob/main/docs/mcp-native-validation.md#controlled-chrome-window-state-follow-up-2026-10-07)
records static-state evidence and its limits.

## Errors, native dialogs and task completion

CONNECTION_RECOVERY_REQUIRED means the affected upstream is isolated after
timeout/cancellation while the app remains owned. Preserve reported identities;
explicitly restart the live connection or Close when authorized. After actual
application exit its connection/session is removed; retry requires start with
new connection/session identities. Never automatically start/restart, replay tools, extend timeouts or
add a screenshot preflight/foreground checklist.

A Windows file picker is a native window. Locate it by the managed application's
identity and handle that existing dialog with available native UI capabilities.
If those capabilities are unavailable, ask the user to handle it. After cancellation,
stop repeating the import action. Official handle_dialog handles page JavaScript
dialogs, not Windows file pickers.

Before ending a target's work, obtain **Close** or **Keep** with no default, unless
the user has already supplied that choice. `dct_connection_stop` takes entryId,
connectionId, sessionId, requestId and disposition. Keep retains app/upstream;
The disposition values are exactly `"Close"` and `"Keep"`.
Close requests normal shutdown and waits for actual app exit without a target
deadline. Continue operation waits while it remains incomplete. Failed/cancelled
Close preserves live app ownership, observation and retry identity. Never
force-kill. `dct_connection_end_task` ends work while retaining live resources;
their later actual exit still removes that connection and is reported.

`dct_connection_restart` requires entryId, connectionId, sessionId and requestId;
optional mcpArgs explicitly replaces configuration. Use it only for a still-live
connection. It waits for old app exit and disposes old resources before creating
fresh resources and session on the same connection and exact original port.
It refuses a busy original port and invalidates old page IDs.
Old operations cannot cancel a later session.

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

If these lifecycle tools are absent, report a plugin/runtime version mismatch.
Use an updated plugin in a new chat once installation is authorized; do not
invent tool fields or fall back to a launch script.
