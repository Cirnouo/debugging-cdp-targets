# Commits, branches, and scope evolution

## Branches

Use a short `codex/<topic>` branch for feature work unless the task explicitly
selects another isolated branch or worktree. Do not rewrite shared history.

## Commits

Use Conventional Commit subjects: `type(scope): imperative summary`. Keep each
commit coherent, stage only files owned by the task, and preserve unrelated
worktree changes. Review the staged diff and run the applicable focused checks
before committing.

Do not push, tag, publish, modify a remote, open a pull request, or change
repository settings without explicit authorization.

## Scope evolution

When a request changes scope, update the governing plan or task brief before
implementation when one exists. Record decisions that change durable
architecture in an ADR and user-visible behavior in the changelog. Do not fold
unrelated cleanup, speculative compatibility, or future extension work into the
current change.
