# Runtime implementation rules

Use four spaces and LF in maintained source and documentation. Every source
directory must document its direct contents and ownership in README.md.
Only cdp-session.mjs may have a shebang or direct-execution guard.

Dependencies flow from entry/interface to application, application to domains
and adapters, and all layers to shared. Domains never import filesystem,
child_process, HTTP, PowerShell, os, process, application, or adapters.
Adapters never import application or interface. Keep import graphs acyclic.

Preserve one managed session, loopback-only CDP, verified process creation time,
Windows session, executable identity, listener ownership, daemon identity,
exact package version, disabled usage statistics and CrUX, extension capability
gates, and unconditional PWA rejection. Never force-kill a process or start a
replacement target during reconciliation or Invoke.

The public actions are start, resume, invoke, status, and stop. Public target
adapters and persisted values are chrome and generic-cdp. Do not accept legacy
target flags, legacy values, or old state namespaces.
