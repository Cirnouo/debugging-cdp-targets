# Documentation ownership

## Audiences

- The root `README.md` is user-facing: installation, operation, security,
  privacy, limitations, and troubleshooting only.
- `CONTEXT.md` is a single-context glossary. It defines domain language and
  contains no implementation rules.
- `docs/policies/` owns repository-wide contribution requirements.
- `docs/adr/` records accepted architectural decisions.
- The installable payload owns agent workflow and target-specific references.

## Directory documentation

Every tracked, human-maintained non-root directory must contain a `README.md`
that names its direct files/subdirectories and states their ownership. Generated,
dependency, internal tool-output, and test-result directories are exempt.

Source implementation rules belong in the nearest relevant `AGENTS.md`. Add or
update a local file when a module needs rules that should not affect siblings;
do not centralize module boundaries in repository policy. Keep `CLAUDE.md` as a
relative symlink to the root `AGENTS.md`, never a copied file or text placeholder.

Keep relative links valid, names consistent with the glossary, and examples
aligned with the public CLI. Update user documentation and changelog entries in
the same change as affected behavior.
