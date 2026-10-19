# Repository organization

Read this policy before adding, splitting, merging, renaming or moving maintained
files, or changing which content responsibilities they own. It applies to source,
tests, tooling, documentation, instructions and packaging inputs. These are local
repository conventions, not requirements attributed to Electron, React or another
external standard. Organization changes preserve the existing runtime, ownership,
security and delivery contracts unless a behavior change is separately in scope.

## Current layout and migration direction

Use the current maps in [source](../../src/README.md), [tests](../../tests/README.md),
[tooling](../../tooling/README.md), [documentation](../README.md) and
[packaging](../../packaging/README.md), together with all applicable ancestor and
local `AGENTS.md` files. READMEs describe current placement; AGENTS and policies
govern implementation. The source retains technical layers alongside the delivered
Gateway argument, supplied target model and diagnostic owners in `src/gateway/` and
[Host payload proof](../../src/host-plugins/README.md) in `src/host-plugins/`.
Argument rules and `gateway/targets/model/` identity/resource contracts, launch/
isolation values and native argument composition remain pure. Domains may depend
only on the exact relative isolation.ts and launch-command.ts model owners in
addition to domains/shared; Host payload/shared gain no Gateway permission.
Shared environment-key.ts serves actual target and Official consumers. PortRange
and the standalone chooser remain an explicitly unfinished
`domains/cdp-target.ts` residue; actual claim-before-await/lifetime stays in its
current target host. Only `gateway/diagnostics.ts` reads its existing clock
and depends on the pure current `domains/control-contract.ts` value/callback types.
The complete lifecycle-contract move remains pending with its App UI/CDP domain
consumers. Existing layer, pure-model and I/O rules remain in force for all current owners.

[Tooling governance](../../tooling/governance/README.md) separates supplied commit
events and pure grammar from actual message execution and Git/history auditing.
[Text policy](../../tooling/quality/README.md) owns shared pure style and YAML
filename rules. [Release tooling](../../tooling/releases/README.md) separates pure
supplied-value Markdown notes from the complete tag/remote/draft/publication
transaction. [Submission values](../../tooling/submissions/README.md) own the
shared Markdown scanner and supplied PR-template/Issue-form policies at their
actual governance and feedback callers. Their central
[tooling tests](../../tests/tooling/README.md) explicitly select direct scanner and
policy suites; [literal submission evidence](../../tests/fixtures/submissions/README.md)
retains raw commit/PR fixtures. The invoked Issue feedback transaction and REST
adapter remain at root tooling with their root suites and HTTP preload;
other tooling and test owners retain their current placement.

The selected direction is source roots named for cohesive domain responsibilities,
with subdomains or technical boundaries inside them when needed; central root
`tests/` corresponding to those responsibilities; and tooling organized by its
actual responsibilities and meaningful names. Maintained implementation planning
lives at root [.superpowers/](../../.superpowers/README.md). Future reviewed
specifications use the same planning owner and narrow tracking rules. The reviewed
[complete content plan](../../.superpowers/plans/2026-10-18-repository-content-reorganization.md)
records the remaining target, content boundaries and delivery batches. Proposed
paths do not become current placement until their owning migration updates the
maps and instructions.

Until each migration updates its maps and instructions atomically, place work
with the existing owner, including that bounded Gateway slice. Do not introduce
a parallel future tree or copy a module into a proposed domain to anticipate
that migration. Root `.superpowers/` contains
individually tracked planning entries and ignored private work. A future reviewed
plan requires an exact per-file `.gitignore` exception and a matching plans
inventory entry in the same change. Keep its `sdd`, native stages, logs and other
private evidence ignored and out of tracked planning relocations, maintained
publishable paths and staging. Never blanket-unignore that material. Bounded
retention copies between exact ignored private locations remain permitted within
the authorized task. Any planning relocation must identify the exact reviewed
files, preserve destination collisions and use narrow tracking rules without
exposing private material.

## Choose content ownership before a filename

Before creating or reorganizing content:

1. State the behavior, rule, evidence or reusable operation being added, and find
    its existing owner in the current maps, exports, callers and tests. Extend
    that owner when the responsibility and audience are the same. A new filename
    alone does not establish a new responsibility.
2. Identify the state, transaction, resource lifetime, trust boundary and I/O
    involved. Keep each invariant under a clear owner. A file may be split when
    it combines responsibilities that change independently; merge duplicated
    implementations when they truly implement the same contract. Independent
    verification against separate evidence is not accidental duplication.
3. Choose a name that describes the current purpose in the repository's
    [domain language](../reference/domain-language.md). Align file, export and test names
    with that purpose. Avoid misleading historical names, catch-all `utils` or
    `context` modules, and names based only on the task that introduced them.
    Rename actual callers together rather than retaining old-name forwarding
    wrappers or duplicate implementations.
4. Check whether existing placement can express the boundary. Add a directory
    only for a real cohesive responsibility or useful technical boundary, without
    uniform empty layers, arbitrary file-size, line-count, file-count or depth
    limits. Do not create npm packages, workspaces, barrels or generic frameworks
    merely to express a proposed folder structure.

For example, a new closed management command belongs with the current management
contract and dispatch owners and their observable tests. It does not need a new
generic command framework. A license collector used by App and fixture builds
needs one truthful reusable owner rather than copies in both builders. Such a
content extraction must include its real callers and validation, not just moves.

## Source and ownership boundaries

Keep pure validation and models separate from environment, filesystem, network,
process and native I/O. Follow the current [source rules](../../src/AGENTS.md) and
their applicable local rules; preserve their dependency direction when content
moves. Cross-domain collaboration uses explicit narrow contracts. Shared content
must have actual consumers with the same semantics, not serve as a default home
for uncertain ownership or a mutable bag of unrelated state.

Preserve one owner for each transaction and resource lifetime through a split.
In particular, keep actual official execution accounting associated with its
originating client facilities, and preserve generation fences, operation result
ownership and definitive cleanup barriers. Do not distribute those mutable facts
among independently authoritative modules. Preserve the distinct purposes of a
UI pending-job barrier and a host synchronization transaction instead of merging
them because both report busy state. The existing [Core contract](../shared-core.md),
[App contract](../app-runtime.md), [security policy](security.md) and accepted
[ADRs](../adr/README.md) remain their authorities.

Technical organization inside a domain must reflect actual boundaries. Electron
main, sandboxed preload and renderer are useful trust and execution boundaries;
they do not make host plugin or gateway business logic renderer responsibilities.
OS helpers are technical support for their actual consumer, not automatically a
new business domain. No layout convention grants additional renderer, native or
administrative authority.

## Tests and tooling

Keep tests in central root `tests/`, using the current inventory until an atomic
migration establishes corresponding domain groups. Name and group suites by
observable behavior and failure contracts, rather than requiring one file per
source function. For example, scoped restart, detached execution and directory
lifetime are distinct observable contracts even when they currently share a
runtime file. Split or combine test content accordingly while preserving the
actual scenarios and meaningful coverage.

Share fixtures only for justified reuse of a setup or controlled I/O boundary.
Keep fixture support distinguishable from regression assertions and actual native,
host or GUI acceptance. Do not build a second implementation of production rules
inside a fake. Preserve the safe default test lane, existing native/GUI opt-in
and coverage requirements in the [verification policy](quality.md#verification)
and [test rules](../../tests/AGENTS.md). Moving a file must not make a recursive
glob silently run an opt-in test or silently omit a default regression.

Organize tooling by the operation or evidence it owns. Separate a command entry
from reusable logic when real callers or a distinct validation boundary justify
it; keep a cohesive transaction together otherwise. Preserve user-facing pnpm
command names and meaning during structural changes. Keep pure metadata,
dependency-free preflight, build/staging, license collection, audit evidence and
remote publication boundaries explicit under the [tooling rules](../../tooling/AGENTS.md).
A new folder is not a reason to add a CLI framework or weaken a validator.

## Documentation, evidence and delivery

Choose the document owner by audience and purpose under the
[documentation policy](documentation.md): current user instructions belong in
the user guide and installed Skill; repository rules in policies; local
implementation constraints in applicable AGENTS; current architecture and
protocol contracts with their existing documentation owners; durable decisions
and supersession in ADRs; reviewed scope and implementation steps in maintained
plans; and dated observations, failures and acceptance limits in evidence.
The root README retains its user-entry boundary. The glossary defines terms,
not implementation organization, and remains the sole glossary.

Keep historical ADR, plan and evidence facts intact. Rebase valid links when
relocating them, preserve anchors and distinguish live code pointers from paths
or commands recorded as historical facts. Current supported-behavior documents
must not present a proposed layout or unexecuted acceptance as delivered.
Do not use private scratch evidence as the only authority for a maintained rule.
Instruction moves and new conditional owners also follow
[progressive disclosure](documentation.md#instruction-progressive-disclosure).

Edit maintained packaging and build inputs, then regenerate and compare their
outputs through the existing build contracts. Do not hand-maintain generated
peers or use copied output as its own inventory authority. Preserve exact
maintained-source/output equality, explicit inventories and original official
and native release content under the [supply-chain policy](supply-chain.md).
Organization is not permission to alter original bytes, refresh hashes, acquire
dependencies or publish artifacts.

## Complete a structural change together

Record the before/after content owners, affected symbols/callers and preserved
contracts for the actual change. Read the applicable instructions for both the
source and destination before editing. Update the affected local READMEs and
AGENTS mappings, imports, test selection/fixtures, build inputs, audits, licenses,
commands and links in the same coherent change. Keep each intermediate delivered
state usable; avoid parallel old/new implementations or broad compatibility
wrappers. A later migration must update this policy's transition description and
the current maps/instructions together.

Run focused checks appropriate to the affected behavior, imports, inventories
and instructions, then the required gates in the [verification policy](quality.md#verification).
For a prose-only change, review semantic ownership, triggered instruction reads,
relative links/anchors and text/repository checks; do not add tests that merely
mirror the wording. Preserve separate evidence for static checks, scenario
walkthroughs and executed host/native/UI behavior. Record actual results and
remaining limits under the existing [submission policy](commits-and-scope.md#commits).
Review the complete diff and exact owned file set, including new files, without
staging unrelated work or ignored private artifacts.
