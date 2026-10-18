# Domain language

- **Target application**: application explicitly known to expose browser-level CDP.
- **Framework**: application technology; its name does not prove CDP compatibility.
- **Rendering implementation**: renderer such as Chromium or WebView2.
- **Plugin host**: Agent environment that loads a thin Plugin, currently Codex or Claude Code.
- **App**: consciously launched desktop gateway and management UI, one per OS user.
- **Static entry**: host direct HTTP configuration cdp-targets pointing at the App.
- **Registration**: bearer-authenticated memory-only owner of connections and jobs, independent of chat, socket or MCP session.
- **Registration identity**: public UUID used for ownership summaries, distinct from its private one-time bearer.
- **Connection identity**: random UUID for one independent target task and its official MCP connection.
- **Session identity**: fresh public route UUID changed after either target or official side restarts.
- **Session owner**: in-memory resource-generation owner; logical router/directory and target/official generations have independent lifetimes.
- **Isolation intent**: the user's choice between no data directory isolation and an explicitly selected isolation directory.
- **Data directory**: the real filesystem directory selected for application state under the isolation contract.
- **Directory selection**: the choice of an existing or newly created application data directory; the [ordered selection procedure](../user-guide/workflow.md#select-a-directory-and-cleanup-policy) defines the available choices and cleanup decision.
- **Application binding**: the researched argument or environment carrier directing a particular application/version to its data directory.
- **Isolation support**: verified full, partial or unsupported coverage of application state and production effects; unknown means unresolved evidence.
- **Directory lease**: connection-level ownership of a selected real data directory across target sessions.
- **Directory cleanup policy**: retain or delete-on-release authorization applying to the whole selected real directory, including pre-existing contents.
- **Directory release**: the end of directory ownership after no live or pending application or relevant resource can use it.
- **Directory evidence**: explicit operation metadata or selected configuration describing the real path, cleanup policy and state.
- **Current target**: verified newly launched process belonging to one session.
- **CDP endpoint**: verified loopback discovery and browser WebSocket address.
- **Official Server**: unmodified upstream chrome-devtools-mcp child for one connection.
- **Gateway**: App-owned core and official SDK HTTP composition managing independent connections.
- **Routing identity**: required _dct registrationBearer/connectionId/sessionId object removed completely before official invocation.
- **Lifecycle operation**: MCP-accepted asynchronous mutation with stable operation identity.
- **Request identity**: caller identifier binding identical mutation retries to one operation.
- **Event cursor**: replay position in an operation's bounded in-memory event queue.
- **Native application identity**: actual application PID, creation time, path and observed process handle.
- **Actual exit**: confirmed end of the managed application's process lifetime.
- **Observation failure**: loss of reliable application lifetime evidence without confirmed actual exit.
- **Permission wait**: OS authorization phase before application creation, separate from CDP readiness.
- **Fixed tool catalog**: complete reviewed official tool names and compatible schema variants exposed to the host.
- **Enabled tools**: one connection's actual official tools/list, with its exact input schemas.
- **Connection summary**: identity and bounded target/upstream state without configuration, tool schemas or diagnostics.
- **Configuration recipe**: complete explicit mcpArgs satisfying a tool's reviewed activation conditions.
- **Detached official wait**: ended client response wait whose actual official execution remains owned until real response or definitive upstream termination.
- **Disposition**: explicit Close or Keep choice without a default.
- **Kept target**: application and upstream retained within its live connection.
- **Terminal result**: explicit owned operation snapshot returned by status, wait, cancel or an identical mutation retry, without a notice queue or acknowledgment.
- **Exit cleanup**: revocation of a terminated session followed by disposal of all its owned resources.
- **Cleanup ledger**: in-memory record of App-owned resources awaiting disposal retries after their session is removed.
- **Retired connection**: connection removed after actual target exit and attempted exit cleanup.
- **Port reservation**: gateway-local ownership of a selected target port for one session lifetime.
- **Profile reservation**: gateway-local claim preventing simultaneous launches with the same canonical Chrome directory, distinct from native profile ownership.
- **Directory claim**: gateway-local ownership preventing concurrent equal or ancestor/descendant real data directory selections.
- **Closed connection**: removed target connection after actual exit; the gateway remains reusable.
- **Live restart**: user-authorized target, official or both replacement using the same logical connection and immutable snapshot, with a fresh route session.
- **Recovery**: explicit scoped restart or Close after diagnosed connection failure without automatic replay.
- **Plugin payload**: thin host manifests, instructions, artwork, documentation and license.
- **Host distribution**: complete Plugin payload adapted to one Plugin host's installation interface.
- **Packaging input**: maintained material used to assemble a host distribution.

## Version and deployment terms

[ADR 0017](../adr/0017-singleton-desktop-app.md) owns the design. The
[App runtime](../app-runtime.md) states implemented behavior and separates local
staging from pending installer/deployment acceptance.

- **App version**: independent strict SemVer in root package.json.version.
- **Plugin version**: one strict SemVer owned by shared Skill metadata and matched
    by both maintained and generated host manifests, independently of App version.
- **Launch snapshot**: immutable successful launch, resolved environment, official
    configuration and initiating roots used by every scoped restart.
- **Latest stable plugin record**: future schema-versioned static record naming
    one stable plugin version, minimumAppVersion and immutable verifiable source
    for both host payloads. No record/feed is advertised for unreleased 0.1.0.
- **App scope**: the commit responsibility named `app`; the [commit policy](../policies/commits-and-scope.md#commits) defines its governance and related scopes.
