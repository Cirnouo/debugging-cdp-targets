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

Keep authoritative contributor rules in root AGENTS.md and these policies.
CONTRIBUTING.md provides the human setup and contribution entry point and links
to those rules. SECURITY.md owns vulnerability reporting.
Maintain progressive disclosure rather than copying all policies everywhere.
Plugin instructions must be concise and application-agnostic. Do not collect
application-specific debugging recipes; Agents explore after connecting.

User-facing documentation, prompts, and installed Skills describe current
supported behavior. Mention rejected or superseded exploratory features only
when they explain a concrete common mistake and its correction. Keep design
history in ADRs and environment-specific migration diagnostics separate from
normal usage instructions.
