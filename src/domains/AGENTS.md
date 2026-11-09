# Domain implementation

Before changing this layer's singleton App architecture, read
[ADR 0017](../../docs/adr/0017-singleton-desktop-app.md). The direct HTTP App owns
all resources; thin host plugins contain metadata, artwork and the shared Skill.

Do not import Node I/O, adapters, application, or environment globals. Inputs
carry evidence and environment mappings; output rules are deterministic.
Identity must fail closed, not guess a different framework contract.
The exact app-ui.ts additionally consumes parseAppConfiguration as a VALUE and
AppConfiguration/AppConfigurationState as TYPEs from desktop/configuration/model.ts.
Before changing that schema consumer, read the cumulative
[configuration instructions](../desktop/configuration/AGENTS.md), ADR 0017 and the
[accepted singleton plan](../../.superpowers/plans/2026-10-17-singleton-app-plan.md).
No domain gains a store dependency or other desktop I/O authority.

Before editing a consumer of target launch or isolation values, read the
[pure target model instructions](../gateway/targets/model/AGENTS.md). This layer
may import only the exact relative isolation.ts and launch-command.ts owners in
that directory, including erased syntax. Other Gateway dependencies remain
prohibited. Host payload and shared owners gain no such permission.

For the accepted [isolation design](../../docs/adr/0015-explicit-data-directory-isolation.md),
preserve required explicit intent, existing/new operation and cleanup choice in
consumers. Pure parsing and opaque binding belong to those model owners; absolute
selection validation and filesystem evidence remain with adapters. Preserve the
validation-before-acquisition order. Directory evidence is supplied input, never
an inferred location or application-isolation guarantee.
