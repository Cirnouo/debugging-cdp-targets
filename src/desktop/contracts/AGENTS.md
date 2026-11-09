# Closed Desktop management contracts

Root, source and Desktop instructions apply cumulatively. Before changing these
messages, projections or their consumers, read [ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md),
the [accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md)
and the cumulative [configuration instructions](../configuration/AGENTS.md).

commands.ts owns the management channel, closed request/command/bridge types and
both complete parsers. It consumes snapshots VALUE/TYPE, configuration/model
VALUE/TYPE, shared/errors and the current domains/control-contract VALUE/TYPE;
domains/host-management stays TYPE-only. Keep private route/id closures with the
parser, validation/failure order, explicit scoped routes and 1..256 duplicate
checks. Never admit start, bearer readback or arbitrary IPC.

snapshots.ts owns all summaries, selected-operation evidence, failure values and
both complete snapshot validators. It consumes configuration/model, shared/errors
and current domains/control-contract VALUEs. Host and exact target isolation
evidence stay TYPE-only; before changing that evidence consumer read the
[target model instructions](../../gateway/targets/model/AGENTS.md). The exported
validateAppManagementFields assertion has one implementation here and commands
imports it as fields. Preserve closed keys, text/count/native bounds, optional
presence, selected-only paths, original failures, validation then clone and
configuration consistency/freeze behavior. No commands dependency or runtime cycle.

Only the exact existing interface/application caller roles in the repository
auditor consume these contracts. Main and Host consume snapshots TYPEs; window,
preload, manager and trusted management validate snapshot VALUEs. Window, preload
and trusted management consume command VALUEs; manager, renderer and Host consume
command TYPEs. These are module VALUE/TYPE roles, not symbol-level permissions.
Unknown siblings remain pure and dependencyless. No store, Main, adapter, mutable
Gateway, clock, Node, Electron, React, SDK, native or ambient process/network power
is granted. Main/Host/UI mutable joins and window acquisition/sender checks remain
whole at their existing owners. Add no facade, duplicate validator/state or queue.
