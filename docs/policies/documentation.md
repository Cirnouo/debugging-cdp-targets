# Documentation ownership

The root README is the user entry point: project overview, requirements, a short
host-specific quick start, common workflow and links to detailed documentation.
docs/user-guide/ owns complete installation, operation, compatibility,
configuration, privacy and troubleshooting guidance. docs/domain-language.md
defines terms only. Repository requirements belong here; implementation
constraints belong in applicable ancestor and local AGENTS.md files; decisions
belong in docs/adr.

Every human-maintained non-root directory has a README naming its immediate
files and subdirectories. The `.github` directory uses `INDEX.md` instead:
GitHub prioritizes a README there over the root README on the repository home
page. Do not add a README directly under `.github`; its subdirectories still
use `README.md`. Generated dependency, Git, coverage, and test-output
directories are exempt. The committed Plugin dist directory includes a README
because it is a supported installation surface, although its code is generated.
Its `official-server/` subtree preserves upstream documentation unchanged only
after complete release verification; it requires no repository README additions.

`packaging/shared/` owns the complete host-neutral Skill and shared distribution
documentation; `packaging/codex/` and `packaging/claude-code/` own authored host
configuration and installed guides. A host's source `README.md` documents its
directory, while `plugin-README.md` supplies its installed guide. Update these
inputs and regenerate both complete `plugins/<host>/debugging-cdp-targets/`
payloads. Host-specific install and Hook controls belong in installed host guides
and docs/user-guide/installation.md; the root README keeps each supported host's
short quick start. Add supported hosts as additional sections and adapt to each
host's documented interface; lifecycle instructions remain shared. Installed
guides link repository user documentation with absolute GitHub URLs so their
links remain usable outside a contributor checkout.

Keep authoritative contributor rules in root AGENTS.md and these policies.
CONTRIBUTING.md provides the human setup and contribution entry point and links
to those rules. SECURITY.md owns vulnerability reporting; CODE_OF_CONDUCT.md
owns community behavior and private incident reporting.
Instruction maintenance follows the progressive-disclosure policy below.

## Instruction progressive disclosure

Before editing human-maintained repository-owned `AGENTS.md`, `SKILL.md`, their
instruction references or their layout/loading rules, read this section. It
adopts the Agent Skills practice of
[structuring large Skills with progressive disclosure](https://agentskills.io/skill-creation/best-practices#structure-large-skills-with-progressive-disclosure).
Its application to AGENTS files and the requirements below are local repository
policy, not requirements attributed to the Agent Skills specification. Unchanged
official upstream Skills remain complete release content; generated host
payloads are rebuilt from maintained inputs rather than edited independently.

### Usable entries and conditional owners

Keep enough common guidance inline for an entry's normal workflow and critical
cross-task boundaries. Root AGENTS retains formatting, preservation,
authorization, branch basics, architecture/security, the supported toolchain,
test-first development and routine validation/build boundaries. Main SKILL
retains common question rules, authorization, discovery/identity, launch and
isolation, routing and task lifecycle. Do not turn either entry into a pure
index. Applicable ancestor and local AGENTS files apply cumulatively; a local
file does not replace its parents.

Move detail because it is conditional and has a clear owner, not to meet a word,
line, byte or token threshold. Do not impose mechanical length gates or split
instructions into tiny files that require a chain of prerequisite reads. Each
complete procedure or contract has one canonical owner. Entries may retain a
short common guardrail and link to that owner without copying the full procedure.
Current forms/templates own their exact labels and choices; policies own their
submission semantics. Avoid competing catalogues or copies of command procedures.

Every conditional owner needs a reachable link and an explicit before-use
trigger naming the operation and timing, such as before editing CHANGELOG,
creating/editing a PR, or creating a Windows worktree. A navigation list alone
is insufficient. Read the owner before the action or preparation it governs;
do not preload all policies or references at startup. Reuse an already-read
common contract while it remains current. Keep common, local and conditional
instruction ownership clear when moving content between them.

### References, language and installed content

Use `references/` for instructions read to perform a task, including question
catalogues, factual variable explanations and operational configuration examples.
Use `assets/` for consumable static resources or reusable starting material used
to produce an output, such as document/configuration templates, artwork or data.
Choose by use and ownership, not filename, extension or the word "template".
The project artwork role of `packaging/shared/assets/` remains separate.

For the Skill's [canonical-question workflow](../../packaging/shared/skills/debugging-cdp-targets/SKILL.md#canonical-user-questions),
first use its inline gates to decide whether a question remains necessary.
Notice-only cases or an applicable prior answer require no question references.
Only before a still-needed question, read the common contract and the current
conversation-language catalogue. Follow the main SKILL's language-choice rules:
established mixed-language conversations retain the current language; switch the
whole template when that language changes. Do not actively read both catalogues.
Reuse the common contract after reading it. This is not a general restriction on
reading multilingual evidence or a requirement to translate repository documents.

Skill instruction references must be directly reachable from `SKILL.md` through
relative links that work from the installed Skill root, without prerequisite
reference chains. Installed guides link repository documentation with absolute
GitHub URLs. Edit the shared maintained source and declared host inputs; rebuild
both complete host payloads. Include every referenced instruction file and its
README in the exact explicit inventory in `tooling/payload-policy.ts` and in
independent exact directory expectations. Preserve maintained-source-to-host
equality in both directions, excluding only declared host overlays. Do not derive
an allowlist dynamically from copied output. Missing/extra files, deletion/rename,
byte drift and identical stale peer payloads must remain detectable.

### Semantic migration and evidence

For any instruction move or split, map every baseline obligation to retained
inline guidance or a canonical owner plus explicit before-use trigger. Check
preconditions, prohibitions, authorization, defaults, ordering and exceptions;
account for every obligation before removing its original text. Exercise
representative task scenarios, naming applicable entry/ancestor/local instructions,
triggered owners and the point each must be read. Include ordinary work and each
affected conditional operation, including future instruction/layout maintenance.

Verify relative links and heading anchors, text/repository checks, exact payload
inventories, source equality and build drift as applicable. Do not add tautological
wording tests or treat size reduction, grep results or a successful links check
as semantic preservation. Record mapping, scenario scope, actual commands/results
and remaining limits in the PR `Verification` section or linked durable evidence;
scratch reports may support review but do not become policy authorities.

Distinguish static repository checks and scenario walkthroughs from executed host
read traces and adherence. Entry injection or metadata acceptance does not prove
that a deferred reference was read at its trigger, that only one locale was read,
or that an instruction was followed. Claim those behaviors only when a trace or
other direct execution evidence establishes them; otherwise state the unverified
scope and retain dated host acceptance evidence with its existing owner.

## Root README content boundary

The root README helps users understand the project, check prerequisites and
complete a first supported task. Every added, changed or retained substantive
paragraph must explain what the project does, what users need, how to install
and explicitly invoke the Skill, what to expect in a first task, or where to
find complete instructions.

Keep each supported host's minimal verified installation commands and necessary
connection-enablement or restart steps, explicit Skill invocation, a task
example, and brief isolation-choice and Close/Keep expectations. Current release
status and concise documentation, contribution and security navigation may
remain. Do not remove necessary first-use steps merely to shorten the page.

Complete configuration options, directory-selection order and cleanup rules
belong in docs/user-guide/. Host metadata fields, consumers, primary research
and host acceptance evidence belong in docs/host-metadata.md. Test matrices,
platform acceptance and implementation details belong in the corresponding
compatibility guide, test documentation, source documentation or ADRs. Do not
add research or acceptance summaries to the root README merely because a
related implementation changed; use the existing detailed documentation owners.

A current limitation may appear briefly only when it has a concrete user
consequence or required next action affecting first installation, invocation,
task operation or applicability. State only the limitation and action or
consequence needed at the entry point, and link to its detailed owner. A general
claim that evidence might affect adoption does not justify acceptance history,
unverified-item lists or evidence matrices. For example, retain the necessary
explicit Skill invocation without repeating its injection acceptance history.

Before committing a root README change, semantically review the entire resulting
page, including added, changed and retained content:

- Check each substantive paragraph's user-entry purpose and detailed content
    ownership, and remove or relocate content outside this boundary.
- Preserve necessary installation commands, host-specific invocation and setup
    steps, the task example, key operation expectations and useful guide links.
- Verify that recommended actions and support claims match current supported
    behavior and the evidence for that host and platform. Repository checks,
    CLI verification and manual Desktop acceptance are distinct evidence levels;
    checking them does not require copying their records into the root README.
- For each limitation exception, identify its concrete user consequence or next
    action and ensure that the linked detailed documentation owns the evidence.

Record the actual review scope, conclusions, applicable exceptions and remaining
limits in the existing PR `Verification` section, with references to the
corresponding detailed documentation. An unexplained statement such as
"README boundary checked" is insufficient. Passing format, link or repository
checks does not establish that this semantic review has been completed.

## Host metadata research

Before the first implementation for a new host, or a change to an existing
host's metadata contract, independently research that host's current official
documentation and applicable versioned implementation. Do not derive its
requirements from another host, a publication portal, or a prior conversation.
Record the result in [host metadata](../host-metadata.md), the single owner of
primary host research. For each manifest, Marketplace, Skill and MCP metadata
surface, name the consumer, supported interface, defaults, precedence and path
base, adopted value or deliberate omission, necessity, research date, host
version and direct primary sources. Distinguish documented support, inspected
implementation, repository checks, executed host smokes and manual UI evidence.
State unsupported fields and unverified presentation explicitly. Self-install
contracts must not inherit public-submission requirements without an applicable
local consumer or a separately adopted repository quality requirement.

Research each relevant actual presentation entry independently, including Plugin
detail, the Skill picker and selected Skill mentions when applicable. Record its
consumer, observed result and remaining unknowns with the host version and date.
Metadata parsing, API-returned fields, renderer source inspection and actual UI
navigation/rendering are separate evidence: acceptance at one entry does not
establish acceptance at another. A version-limited host consumer that does not
read a presentation field is a legitimate documented limit. Do not invent
unsupported fields, rename ordinary Skills or misrepresent them as
artifact-template types to imply unsupported presentation behavior.

Update that record when evidence or the adopted contract changes. Keep source
references and evidence ownership there; packaging guides, quality rules and
ADRs link to it instead of maintaining competing research inventories. Changes
must preserve the exact maintained shared Skill file set in each host payload;
host-only presentation belongs in declared overlays with independent inventories.

Repository documentation must stand on its own: explain the goal, decision,
current supported behavior, evidence and remaining limits without requiring a
chat transcript or ignored scratch artifacts. Plans may retain decision history,
but user guides and installed instructions must describe the verified result.

## Evidence and supported behavior

When introducing an external convention or standard, cite its direct primary
official source at the first relevant policy statement. Name and link the
version when a suitable versioned source is available. State the adopted basis
and document repository-specific restrictions or customizations. For platform
practices, cite official platform documentation and state relevant configuration
conditions; do not present them as universal industry standards. Repository
policies continue to define the enforceable local requirements.

Plugin instructions must be concise and application-agnostic. Do not collect
application-specific debugging recipes. Agents verify the application/version's
startup contract and research requested isolation before connecting, then explore
pages and debugging behavior after connecting. No isolation skips isolation
research and directory questions. For isolation, document full, partial,
unsupported and unknown evidence separately; a framework label is not proof.

Accepted forward designs may establish contributor and source requirements before
runtime implementation. Mark that gap explicitly in ADRs and contributor docs.
Installed Skills and user guides change with the verified implementation rather
than presenting accepted designs as current supported behavior.

User-facing documentation, prompts, and installed Skills describe current
supported behavior. Mention rejected or superseded exploratory features only
when they explain a concrete common mistake and its correction. Keep design
history in ADRs and environment-specific migration diagnostics separate from
normal usage instructions.
