# MCP HTTP

The singleton App serves strict MCP 2026-07-28 requests and sessionful legacy
HTTP at one loopback endpoint. The App uses public client, core and server SDK
2.3.1 and Node HTTP transport 2.1.0. The original official child uses its public
stdio interface. [ADR 0018](../adr/0018-mcp-protocol-compatibility.md) records
the dual-era decision and the 2026-10-23 HTTP admission security amendment. The
[dated Host compatibility record](../evidence/host-plugin-research.md#mcp-protocol-compatibility-research--2026-10-17)
distinguishes fixed-version host source research from actual wire acceptance.

## HTTP and authentication

The [Node adapter](../../src/adapters/mcp-http-server.ts) binds only
`127.0.0.1` and checks the exact effective-port Host, methods, content type and
Origin. The raw request target must equal the literal `/mcp`. Query-bearing
targets, absolute URLs and paths that would normalize to `/mcp` are refused.
Forwarded headers confer no authority. Rejections omit raw requests, tokens
and paths.

Each POST is limited to 1 MiB of actual UTF-8 bytes, including chunked bodies,
10,000 cumulative object members plus array elements, and 64 nested containers
including the root. The Node adapter bounds bytes before one JSON parse. An
iterative check of the entire envelope runs before public SDK era classification,
SDK schema validation or App dispatch. Metadata, capabilities and
`inputResponses` share the limits. Strings consume bytes. Their characters do
not add structural members. An admitted body passes unchanged through the public
`parsedBody` option to either era.

Malformed JSON returns a closed 400 response. Budget excess returns a closed
413 response with a fixed message. Refusal preserves pending continuation
rounds, healthy own or peer legacy sessions, peer requests, owned Core
connections and actual official execution. The limits bound per-request work.
Responses and connection counts remain uncapped by this admission policy, which
does not provide complete denial-of-service protection. Larger requests require
less input in one envelope.

Cooperative uploads and exact-boundary checks receive the complete closed JSON
refusal at the client. For flooding or deliberately incomplete uploads, refusal
requires bounded real 413 headers and fixed JSON bytes, a returned response end,
local response finish and actual request-socket closure before any dispatch or
resource acquisition. The client can receive a complete response or a known
closed-upload transport error. Local finish establishes only local completion.
A timeout, partial response or upload error alone is insufficient evidence.
The App does not drain unbounded uploads or add TCP shutdown state to guarantee
delivery.

One [request handler](../../src/adapters/mcp-request-handler.ts) provides the
common Server factory, declarations and authenticated dispatch. Public SDK
classification selects the era. Invalid modern envelopes, unsupported revisions
and header/body disagreements cannot fall back to legacy. Modern requests get a
fresh Server per request, SDK-generated discovery/results/cache metadata and no
MCP session. Legacy initialization uses a separate Server and transport for each
session, with GET/DELETE, session IDs and negotiated facilities. The fixed outward
official and lifecycle catalog advertises no list changes.

Register returns public `registrationId` and private `registrationBearer` once.
Every other lifecycle request supplies that bearer explicitly. Each official
request supplies `_dct: {registrationBearer, connectionId, sessionId}`. The App
strips the entire route before forwarding the original arguments and relays
official results unchanged. Missing, expired or unknown bearers fail before
owned reads or effects. Status, admin and errors never read back the bearer.
A caller with the correct bearer can reconnect through another MCP session.
Authorization headers, HTTP sockets, chats and MCP sessions confer no implicit
owner. See [lifecycle selectors](mcp-lifecycle.md#requests-and-status-selectors).

After authentication, known busy and originating-client facility failures carry
a closed code and fixed actionable explanation. Unknown upstream errors remain
generic. The App never projects arbitrary exception text. A locally known facility
failure stays associated with its owned execution across the official SDK round trip.

## Request lifetime

The handler creates original facilities for roots, elicitation and progress for
each call and retains the current request's identity and abort context. Modern
capabilities come from the request envelope. A modern start authenticates and
parses its arguments, then collects advertised roots with SDK `input_required`
before acceptance or resource acquisition. It retains the validated immutable
roots snapshot for its asynchronous job. Unsupported roots produce an empty
snapshot. A roots continuation keeps the same domain `requestId` and idempotency
even when its JSON-RPC ID changes. Legacy start may return an operation ID while
original roots admission is pending. Normal response completion preserves those
facilities. A real originating client or session disconnect makes them
unavailable and leaves App-owned targets alive.

The public SDK request-state codec signs version, phase, registration principal,
tool, argument fingerprint and original expiry with a process-local random key,
bound to the MCP method. Form state also binds the route fingerprint, flow
identity, round and key. State contains no bearer, path, raw arguments, roots or
form content. After signature verification the handler rechecks current
principal, arguments, route where applicable and the original expiry. A valid
signature alone supplies no ownership.

Modern form input continues one Core invocation across response exchanges. The
process-local holder keeps the original capability limits and one pending round.
Accepted content is validated against that round's requested schema. Decline
and cancel remain real outcomes. Missing input can reissue the current round.
Consumed or concurrent rounds and changed ownership, route or arguments cannot
deliver input. One flow allows at most eight distinct forms with a fixed
600-second deadline starting at the first form. Retries do not extend it.
Normal intermediate Server close preserves the logical invocation. Genuine
active-request cancellation, socket disconnection, abandoned input expiry or
HTTP shutdown retires the holder and detaches facilities. Core retains actual
execution accounting until a real response or definitive upstream close.
There is no completed official-result archive or automatic replay.

Progress uses only the active originating response and its defined current token,
including numeric zero. A continuation can change its token. Intermediate/terminal
completion and detach stop that channel. Peer responses and listen streams
never receive it. Keep the operation wait/status/result path independently of optional
progress. No MCP Tasks requirement, connection-state Resource or automatic chat
question chain is added.

Explicit cancel promptly ends local admission and its SDK wait. Cleanup likewise
terminates admission and retains accurate cancelled or failed state. Late roots
responses are consumed with zero new directory, router, target or official
acquisitions. A detached official response wait retains its execution slot until
the actual response or definitive upstream close. A healthy upstream stays available
after that execution settles, with no replay, restart or quarantine.

Public SDK 2.3.1 cancellation notifications retain the original
`relatedRequestId`, while Node HTTP removes that response's stream mapping after
the accepted response ends. Cancellation over that ended SSE is best-effort and
cannot promise abortion of the remote roots handler. Local termination and zero
late effects remain required. Actual SDK HTTP tests cover this trace. InMemory
tests cover reachable wire abortion. The pinned SDK protocol cancellation and
Node transport send/stream mapping are the source of this limitation. No private
SDK patch or replacement legacy request context is used. Modern input uses the
public standard MRTR facilities described above.

The admission checks use the existing low-level SDK Server, public
`parsedBody` and request-state codec. The SDK's optional
`maxToolInputElements` belongs to McpServer. The App enforces its own whole-envelope
limit and uses neither OAuth middleware nor a redirect override. These source
and SDK regression contracts carry no native App or host acceptance claim.
