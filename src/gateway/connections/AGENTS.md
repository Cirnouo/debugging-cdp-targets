# Resource generations and directory leases

Apply root, [source](../../AGENTS.md) and [Gateway](../AGENTS.md) instructions
cumulatively. Before changing acquisition, lifetime, cleanup or explicit evidence,
read [ADR 0015](../../../docs/adr/0015-explicit-data-directory-isolation.md),
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md) and
[ADR 0018](../../../docs/adr/0018-mcp-protocol-compatibility.md).

resource-owner.ts owns one target, official, logical/router or catalog resource
generation, including pending acquisitions and retryable failed disposal. Enroll
ownership before acquisition. Register and retain late resources even after
retirement; join pending work until actual settlement. Preserve per-resource close
promise identity, all-peer disposal order and failures, resource versions and
retry barriers. Actual-exit evidence comes from the controller, never helper,
transport or observation failure. Abort/retire alone cannot prove application exit.

directory-lease.ts owns one connection lease across all session generations and
removed routes. Prevalidate before acquiring it; retain early acquired evidence
after failed verification. Release requires final release intent and no pending
acquisition/permission wait/late creation, successor, live app or relevant resource
user. An intermediate restart exit cannot release it. Preserve original diagnostic
origin, DataDirectoryError identity, shared release attempts and retryable failures.
Keep adapter filesystem identity/claim/deletion rights with the existing adapter.

Normal Close waits for actual application exit, without a target deadline or
force-kill. Failed Close/observation/rollback retains live ownership. Keep preserves
resources and observation. Failed resource disposal remains in Core's in-memory
cleanup ledger without restoring dead routes; final App exit cannot succeed while
live/pending resources or leases remain. Cancellation detaches client waits only:
Core retains actual official execution and original roots/progress/elicitation
facilities until real completion or definitive upstream close. No new registry,
parallel ledger, automatic restart/replay or persistent session state belongs here.

Preserve preauthorized retain or whole-directory delete-on-release and original
start metadata after failure/cancellation and later cleanup, without rewriting
terminal results or creating another operation. Real paths and raw filesystem
errors remain outside default summaries; only explicit operation/selected
configuration carries path evidence. No new snapshots, awaits or admission,
roots/factory/UUID ordering changes are implied by moving these complete algorithms.

Use only the parent's exact type/adapter dependencies. Neither role gains ambient
process/environment, clock, filesystem, network, native or external-package access;
unknown siblings remain pure. Before editing these instructions or their loading
rules, read [progressive disclosure](../../../docs/policies/documentation.md#instruction-progressive-disclosure)
and [repository organization](../../../docs/policies/repository-organization.md).
