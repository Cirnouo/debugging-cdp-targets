# Thin host distribution tooling

- host-descriptors.ts owns import-free frozen host identities and canonical paths.
- host-metadata.ts parses supplied JSON/YAML and validates exact host manifests,
    Marketplace entries, direct HTTP metadata and Codex Skill presentation.
- payload-inventory.ts owns the closed required file lists and refusal rules.
- artwork-policy.ts validates approved supplied PNG paths and original bytes.
- version-agreement.ts checks original-string Plugin/Skill agreement while allowing
    a distinct valid App version; predicates come directly from the domain owner.
- regular-file-tree.ts owns strict regular-file traversal and supplied-map comparison.
- build-plugin.ts retains complete canonical packaging validation, assembly,
    output synchronization and its read-only check entry.
- audit-plugins.ts independently audits both physical inventories and Marketplaces,
    metadata regularity, two-way maintained Skill equality and disposable-copy bytes.
    It never imports the builder or uses copied output as expected evidence.

Maintained supplied parsing/validation code has no direct environment, filesystem,
process, network or invoked-entry capability. Its unchanged locked YAML parser can
output tokens through LOG_TOKENS/LOG_STREAM and emit warnings at its default warn
level. The existing SemVer domain dependency reads NODE_DEBUG and can emit debug
output. These upstream diagnostic behaviors remain; transitive environment freedom
is not the contract. Tests bind only YAML's three reviewed bare process import
edges to exact resolved parents and source hashes. Import hooks observe imports,
not global process access such as SemVer's; source review covers maintained code.
The tree, builder and auditor retain their distinct complete I/O operations.
Public pnpm commands keep their names and meanings; checks never
repair drift or alter host installation state. Parent tooling rules apply.

The repository's approved artwork profile is static square PNG, at least
48 and at most 4096 pixels, at most 5 MiB, with noninterlaced 8-bit RGBA.
These selected quality bounds remain project requirements; public-submission
artwork rules are not a local runtime contract. The profile is narrower than the
[PNG specification](https://www.w3.org/TR/png-3/). Validation checks chunk CRCs,
a complete bounded pixel stream, and valid row filters. Build assembly checks
the exact shared asset inventory and copies only each host's delivery icons.
Delivery PNGs use only IHDR, consecutive IDAT and IEND chunks. Source artwork
may additionally retain its original `caBX` Content Credentials before IDAT.
[Host metadata](../../docs/evidence/host-plugin-research.md) owns researched consumer support and
limits for Claude's listing icon and Codex's retained dark composer key.
