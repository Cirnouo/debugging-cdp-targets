# Commits, branches, and scope evolution

## Branches

The trunk is `main`. Work branches use exactly one of `feat/`, `fix/`,
`hotfix/`, `chore/`, `docs/`, `refactor/`, `test/`, `ci/`, or `codex/`, followed
by a lowercase kebab-case topic. Release branches use `release/<semver>`; only
release branches may use SemVer dots and prerelease/build separators. Do not
rewrite shared history.

## Commits

Every non-merge commit uses `<type>(<scope>)!: <subject>`, where `!` appears only
for a breaking change. Allowed types are `build`, `chore`, `ci`, `docs`, `feat`,
`fix`, `perf`, `refactor`, `revert`, `style`, and `test`. The single required
lowercase scope is one of `skill`, `session`, `target`, `devtools`, `windows`,
`obsidian`, `distribution`, `testing`, `tooling`, `governance`, `dependencies`,
or `release`.

`obsidian` is retained for historical validation only; new application-specific
behavior is outside the current design. Plugin packaging uses `distribution`;
official Server transport uses `devtools`.

Headers are at most 100 characters. Subjects are non-empty, begin in lowercase,
and do not end with a period. A body or footer follows a blank line; a footer
also follows a blank line after a body. Body and footer lines are at most 100
characters. A breaking change may use `!`, a `BREAKING CHANGE:` footer, or both.
Only Git-topology-proven merge commits are ignored.

Topic commits and raw PR titles use the header above. A raw PR title must not
end in its own `(#<current-PR-number>)`; GitHub appends that suffix when squashing.
The final squash header uses `<type>(<scope>)!: <subject> (#<current-PR-number>)`,
with `!` only for a breaking change. The final GitHub-generated trailing suffix
identifies the PR that produced the squash commit. Preserve that suffix and
check the actual merge message before merging.

Other authored `#number` or `(#number)` references in topic commit subjects,
raw PR titles, and descriptions may identify Issues or other PRs, including a
PR that introduced a regression. These references are distinct from the final
generated current-PR suffix and remain in the predicted squash message.

The 100-character header limit includes the generated suffix. For example,
` (#123)` uses seven characters, leaving at most 93 characters for the raw title.
PR checks validate the raw title and the predicted header with its actual PR
number plus the original PR description. Keep description lines within the same
body/footer limit; editing a title or description reruns the existing gate.

Keep each commit coherent, stage only files owned by the task, and preserve
unrelated worktree changes. Review the staged diff and run the applicable
focused checks before committing.

Do not push, tag, publish, modify a remote, open a pull request, or change
repository settings without explicit authorization.

## Optional Issue and PR references

Issue association and other PR references are optional. When the change resolves
an Issue, use `Closes`, `Fixes`, or `Resolves` followed by its Issue reference.
Use `Refs: #220` for a non-closing reference to an Issue or another PR. Put these
trailers at the end of the PR description, with a blank line after the description
body. Use one reference per trailer line and `owner/repository#number` for a
reference in another repository.

Prefer the PR description for Issue associations and regression-source
explanations so references are visible on the PR and carried into the squash
body. Title references are allowed; titles alone do not close Issues. Topic
commits may also include these trailers, but keep closing keywords in the PR
description so squash merging retains them. Closing keywords in a PR description
create a visible PR-Issue link when the PR targets the default branch; merging
that PR into the default branch closes the Issue. See
[GitHub's issue-linking documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

For example, PR #123 resolves Issue #219 and fixes a regression introduced by
PR #220. Its raw title may be `fix(target): reject stale identity from #220`,
and its complete final squash message can look like this:

```text
fix(target): reject stale identity from #220 (#123)

Fix the stale-session regression introduced by PR #220.

Closes #219
Refs: #220
```

## Scope evolution

Add a scope only for a durable domain or cross-cutting responsibility expected
to recur. Never add one for a file, issue, person, temporary feature, or one-off
migration. Add, remove, or rename a scope in a `chore(governance): ...` change
that updates the shared grammar, this policy, the glossary/context, and relevant
directory documentation. Never rewrite historical commits for a scope change.

When a request changes scope, update the governing plan or task brief before
implementation when one exists. Record durable architecture decisions in an
ADR and user-visible behavior in the changelog. Do not fold unrelated cleanup,
speculative compatibility, or future extension work into the current change.
