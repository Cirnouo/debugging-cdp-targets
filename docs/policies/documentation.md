# Documentation ownership

The root README is for users: installation, operation, compatibility, privacy,
and troubleshooting. docs/domain-language.md defines terms only. Repository
requirements belong here; implementation constraints belong in the nearest
source AGENTS.md; decisions belong in docs/adr.

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
payloads. Host-specific install and Hook controls belong in host guides and the
root README; lifecycle instructions remain shared.

Keep authoritative contributor rules in root AGENTS.md and these policies.
CONTRIBUTING.md provides the human setup and contribution entry point and links
to those rules. SECURITY.md owns vulnerability reporting; CODE_OF_CONDUCT.md
owns community behavior and private incident reporting.
Maintain progressive disclosure rather than copying all policies everywhere.

When introducing an external convention or standard, cite its direct primary
official source at the first relevant policy statement. Name and link the
version when a suitable versioned source is available. State the adopted basis
and document repository-specific restrictions or customizations. For platform
practices, cite official platform documentation and state relevant configuration
conditions; do not present them as universal industry standards. Repository
policies continue to define the enforceable local requirements.

Plugin instructions must be concise and application-agnostic. Do not collect
application-specific debugging recipes; Agents explore after connecting.

User-facing documentation, prompts, and installed Skills describe current
supported behavior. Mention rejected or superseded exploratory features only
when they explain a concrete common mistake and its correction. Keep design
history in ADRs and environment-specific migration diagnostics separate from
normal usage instructions.
