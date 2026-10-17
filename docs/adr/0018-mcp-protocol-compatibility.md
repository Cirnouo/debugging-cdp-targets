# 0018 — Dual-era MCP HTTP and private upstream catalog refresh

Status: accepted, 2026-10-17. App and Plugins remain 0.1.0 Unreleased.
This extends [ADR 0017](0017-singleton-desktop-app.md) without changing its Core,
registration, native resource, thin Plugin or cleanup contracts. It preserves
[ADR 0011](0011-mcp-native-lifecycle.md)'s reviewed fixed outward tool catalog.

## Decision

One App/Core serves strict MCP 2026-07-28 requests and sessionful legacy HTTP
at the same loopback endpoint. A common public SDK Server factory owns fixed
tool declarations and authenticated dispatch. The SDK classifies each request;
modern claims, malformed envelopes and version/header disagreements cannot
downgrade into the legacy session path. One public Node adapter converts the
request, propagates socket abort and writes the streaming response. Existing
Host/Origin/path/method/framing guards and the 4 MiB limit remain in force.

Modern discovery, result discriminators and cache fields come from the public
SDK. Modern clients supply capabilities per request and do not acquire an MCP
session. Legacy clients retain negotiated capabilities, session IDs, GET/DELETE
and their original accepted-operation facilities. MCP sessions are transport
state; every owned call still supplies its registration bearer and route.

The selected final revision's [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
defines discovery, per-request metadata and multi-round-trip input. The future
2026-12-15 draft is outside this decision. Use audited SDK 2.2.0 and Node adapter
2.1.0 public exports; no dependency upgrade, protocol codec or private patch is
needed by this implementation.

## Roots and form input

A modern start parses/authenticates ordinary arguments, then resolves advertised
roots before Core acceptance or directory/router/target/upstream acquisition.
Unsupported roots produce an immutable empty snapshot. Required roots use SDK
`input_required`; a valid answer becomes a captured reader available to the
asynchronous start after its accepted response ends. Legacy starts preserve
their existing accepted-response/late-roots ordering.

The SDK state codec signs version, phase, principal, tool, argument fingerprint
and original expiry using a process-random key. State contains no bearer, path,
arguments, roots or form content. Current principal/arguments and the original
expiry are checked after MAC verification. A roots retry retains the same domain
requestId and Core idempotency contract, independently of its fresh JSON-RPC id.

A modern official invocation has one logical context and one Core invocation.
An in-memory holder resolves the pending form from a continuation on another
request; it never invokes the official tool again. The holder fixes original
capability limits, principal, route, argument fingerprint and one pending round.
Accepted form content is validated against that exact requested schema; decline
and cancel remain real outcomes. Missing/dropped input can reissue the current
round. Consumed/concurrent rounds and changed ownership/routes/arguments cannot
deliver input. At most eight distinct form rounds share one 600-second input
deadline beginning with the first form, without renewal on retries.

Normal intermediate SDK Server close detaches that response channel while the
logical invocation continues. Genuine active-request cancellation, socket abort,
abandoned-input expiry or HTTP shutdown detaches facilities and removes the
holder. Core retains the original actual execution and busy accounting until
the upstream really settles or definitively closes. These events do not close
healthy resources or release a directory lease. Settled results are not archived
in the holder; a late continuation cannot replay the call.

## Progress and operation results

Standard progress follows only the active originating response with its current
defined token, including numeric zero. A resumed request can supply another
token. Intermediate completion, terminal delivery and true detach stop that
channel. Progress never uses a peer or `subscriptions/listen` stream and does
not supply durable result retrieval. The [standard progress contract](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress)
is optional feedback; host presentation remains independently verified behavior.

Keep the seven registration/lifecycle/operation tools, bounded
`dct_operation_wait`, status/result/cancel and ordinary idempotency. No MCP Tasks
requirement, connection-state Resource, automatic chat injection or Hook chain
is introduced. A host's native background-task UI does not establish MCP Tasks.

## Private actual catalog snapshots

The fixed outward official/lifecycle definitions stay unchanged across refresh.
Each real official generation owns its actual tools and read-only catalog
revision/freshness. If the official server advertises `tools.listChanged`, the
native SDK callback marks metadata dirty. One serialized uncapped page walk
validates a complete candidate; a burst coalesces into one dirty follow-up.
Startup drains any dirty follow-up before becoming ready.

Reject repeated cursors, duplicate names, routing collisions and any complete
Tool definition outside the reviewed release variants, including output schema.
Canonical JSON equality permits property ordering differences. Publication is
one atomic snapshot assignment fenced by the original live official owner.
Close/official restart retires that publisher; target-only restart retains it.

A failed refresh retains last-known definitions marked unavailable, emits a
bounded diagnostic and blocks new official forwarding until a later notification
or call admission validates one coalesced refresh. It does not loop indefinitely,
kill healthy resources, alter running calls or replay a tool. Actual call
admission rechecks the accepted snapshot and captures that exact Tool for the
SDK's output validation through the whole invocation.

## Evidence boundary

Public SDK HTTP fixtures cover both eras, roots/form continuation, authenticated
rounds, progress and cancellation. Controlled official I/O covers Core ownership;
catalog fixtures establish notification and schema behavior without launching a
user target. These are SDK/source regression evidence. Dated native host and
target acceptance must name the exact final source separately; an
`independent-sdk-http` capture is never a Codex/Claude capability capture.

The [host metadata record](../host-metadata.md#mcp-protocol-compatibility-research--2026-10-17)
records Codex 0.163.0's legacy default and Claude Code 2.1.302's documented modern
runtime with its capture limits. Preserve default compatibility and the wait
path; no experimental host flag or personal configuration is required.
