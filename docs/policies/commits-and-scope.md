# Commits, branches, and scope evolution

## Branches

The branch rules are this repository's adapted
[Conventional Branch](https://conventionalbranch.org/) profile. The allowed
prefixes, lowercase kebab-case topic, and `release/<semver>` syntax below are
authoritative local choices.

The trunk is `main`. Work branches use exactly one of these short prefixes,
followed by a lowercase kebab-case topic:

- `feat/` for new functionality.
- `fix/` for defects.
- `hotfix/` for urgent fixes.
- `chore/` for standalone documentation, refactoring, tests, CI, and other
    maintenance.

Choose the prefix for the task's overall purpose. Classify each commit
independently using the commit types below; branch and commit types need not
match. For example, `chore/branch-policy` may contain a
`docs(governance): explain branch policy` commit, and `chore/quality-gates` may
contain a `ci(tooling): add quality gates` commit.

Optional release preparation branches use `release/<semver>` with strict
SemVer syntax; only release branches may use SemVer dots and prerelease/build
separators. A release branch does not authorize publication. Formal publication
requires a separately authorized annotated `v<semver>` tag without build metadata
under the [release policy](releases.md). Do not rewrite shared history.

## Commits

The commit format is based on
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
with this repository's required scope, allowed types/scopes, and length
constraints below.

Every non-merge commit uses `<type>(<scope>)!: <subject>`, where `!` appears only
for a breaking change. Allowed types are `build`, `chore`, `ci`, `docs`, `feat`,
`fix`, `perf`, `refactor`, `revert`, `style`, and `test`. The single required
lowercase scope is one of `skill`, `session`, `target`, `devtools`, `windows`,
`app`, `distribution`, `testing`, `tooling`, `governance`, `dependencies`,
or `release`.

`app` owns desktop App lifecycle, management UI, configuration and OS integration.
Plugin packaging and native delivery use `distribution`; official Server transport
uses `devtools`; core connection lifecycle uses `session`. The App scope is a
durable product responsibility, not a temporary migration label.

Headers are at most 100 characters. Subjects are non-empty, begin in lowercase,
and do not end with a period. A body or footer follows a blank line; a footer
also follows a blank line after a body. Body and footer lines are at most 100
characters. A breaking change may use `!`, a `BREAKING CHANGE:` footer, or both.
Only Git-topology-proven merge commits are ignored.

Footer boundaries use the original message lines. `BREAKING CHANGE:` and
`BREAKING-CHANGE:`, `Refs` in any letter case, Issue-closing keywords followed by
an Issue reference, and hyphenated trailer tokens such as `Reviewed-by:` are
reserved footer syntax. Cross-repository references
use the same boundary rule. Their first footer line requires a blank line after
the header or body; subsequent trailers in that footer group can be adjacent.
Existing Markdown bullet breaking notes such as `* BREAKING CHANGE:` require
the same blank line, whether their description starts on that line or the next.

An otherwise unknown bare-word label such as `observations: value` continues
the body when no blank line precedes it. With a preceding blank line, it can
start a generic footer group. This is a syntactic convention for ambiguous
labels, not an inference of prose intent. Hyphenated labels such as
`quick-start: value` remain reserved trailer syntax and require the footer
boundary. A body label cannot hide a later unseparated reserved footer, and
every body or footer still requires a blank line after the header.

The local `footer-leading-blank` rule in `tooling/governance/commit-footer.ts` owns
these boundaries at error severity. The Conventional Commits parser, original
message, other commitlint rules and Git topology checks remain authoritative
for their existing responsibilities.

One PR becomes one logical squash commit on main. Its topic branch may contain
multiple coherent, atomic commits. This repository's required GitHub squash
default is `PR_TITLE` + `BLANK`: start with the PR title and an empty body, then
curate the actual squash message before merging. These are the
[`squash_merge_commit_title` and `squash_merge_commit_message` settings](https://docs.github.com/en/rest/repos/repos#update-a-repository)
for [GitHub's configurable squash messages](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests).
It is repository configuration, not a universal default or a Conventional
Commits rule.

Topic commits and raw PR titles use the header above. A raw PR title must not
end in its own `(#<current-PR-number>)`; GitHub appends that suffix when squashing.
The final squash header uses `<type>(<scope>)!: <subject> (#<current-PR-number>)`,
with `!` only for a breaking change. The final GitHub-generated trailing suffix
identifies the PR that produced the squash commit. Preserve that suffix and
check the actual merge message before merging.

Other authored `#number` or `(#number)` references in topic commit subjects,
raw PR titles, and descriptions may identify Issues or other PRs, including a
PR that introduced a regression. These references are distinct from the final
generated current-PR suffix. Authored references in the raw PR title remain in
the predicted squash header. Description references are independent; select
useful references separately for the curated squash body.

The 100-character header limit includes the generated suffix. For example,
` (#123)` uses seven characters, leaving at most 93 characters for the raw title.
PR checks independently validate the raw title and the predicted final header
with the actual PR number. Both must pass the existing header rules. Editing a
title or description reruns the existing gate.

The PR description and actual squash message must accurately explain the same
important What and Why, but need not share wording or format. Write the PR body
for Markdown readability and review. Commit body/footer line-width and separator
rules do not apply to it. Checks, results, review notes and screenshots may remain
specific to the PR. Use deeper headings within the existing template sections
for review notes rather than adding H2 sections.

The merge author must independently explain the important What and Why in the
actual squash message, adding How when it helps understand the change. Curate
the body from the final change instead of copying the complete PR description.
The default title is only a starting point. No literal `What:` or `Why:` labels
or new message schema are required. The existing commitlint width, footer and
blank-line rules and their exceptions still apply to the complete commit message;
this does not add a retrospective body-presence requirement to history.

Before merging, compare the final header with the validated raw title plus the
actual ` (#<current-PR-number>)` suffix and validate the exact complete candidate.
The existing `validateCommitMessage` in `tooling/governance/commit-validation.ts` supplies raw stdin
to commitlint and can validate that candidate without rewriting it. Use raw stdin
for this check: commitlint's `--edit` parsing can strip comment lines, so it does
not establish that the exact candidate passed. PR CI cannot prevalidate a future
curated body. Push and history checks validate the actual stored commit message.

The current [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)
is the sole source of required PR headings, checklist labels, placement, order,
and starter prose. Keep each H2 section exactly once in order without extra H2
sections, and each template checklist once in its section and original order.
Deeper headings, prose, lists, and code evidence are allowed. Wrapped checklist
labels preserve their original text after whitespace normalization.

Problem and Resulting behavior need content beyond starter prose, comments,
headings, and checkboxes. An Issue link can explain the problem. Verification
must record actual checks, results, and remaining limits beyond its checklist.
Documentation can consist of satisfied checks and conditional reasons. Select
mandatory checks with `x` or `X`. A check containing `when applicable` may remain
unchecked only with an adjacent indented `N/A: <reason>` continuation. Do not
delete unchecked required checks or claim results that have not been observed.

The remote Commit messages check validates the current PR body against this
template independently of commitlint's raw-title and predicted-header checks.
A missing or empty body fails. A failed check blocks merge; edit the title or
body to fix the reported errors and let the
existing PR `edited` event rerun the check. Older PR numbers or historical prose
provide no exception for a current submission. Local, push, and scheduled
history checks continue to validate original commit messages without applying
the current PR template to history. This remote body gate does not run before
sending a PR description.

Keep each commit coherent, stage only files owned by the task, and preserve
unrelated worktree changes. Review the staged diff and run the applicable
focused checks before committing.

Do not push, tag, publish, modify a remote, open a pull request, or change
repository settings without explicit authorization.

## Typed Issue submissions

The current [Bug form](../../.github/ISSUE_TEMPLATE/bug_report.yaml) and
[Feature form](../../.github/ISSUE_TEMPLATE/feature_request.yaml) are the sole
authority for their generated field labels, order, required answers, dropdown
options, and classification labels. GitHub's
[Issue form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
applies the configured labels when those labels already exist in the repository.
The current forms use `template: bug-report` and `template: feature-request`;
Agents using another interface must apply the corresponding form label when
creating or editing a typed Issue.

Classification uses those form labels only. Ordinary freeform Issues without
either label remain allowed and exempt, even if their text resembles a form.
General labels such as `bug` are optional. Both form labels on one Issue are
ambiguous and invalid; choose the corresponding form. `template: invalid` is
reserved for validation diagnostics and cannot classify a form. Do not infer a
type from the body or record persistent Issue identity.

Preserve each generated H3 field heading exactly once and in the form's order,
including optional fields. Extra field-like H3 headings break that structure;
deeper headings, prose, lists, and code may appear in responses. Comments and
headings alone do not answer a required field. Fenced or indented code and
quotes may provide answer evidence but cannot substitute for generated headings.
Required answers must be nonempty and cannot be `_No response_`. Optional
answers may be empty or `_No response_`. A dropdown answer must match exactly
one configured option. This structural policy does not judge semantic
completeness, response length, version grammar, or numbered reproduction steps.

Malformed or unsupported form configuration is a configuration failure,
distinct from invalid contributor content. The supported form profile includes
input, textarea, single-choice dropdown, and static Markdown. Changes to control
types or required structure require explicit policy support before use.
Read the current form before creating or editing a typed Issue, redact sensitive
examples, and follow [SECURITY.md](../../SECURITY.md) for private vulnerability
reporting. Typed body validation has no local command or Agent tool hook.

The remote [Issue forms workflow](../../.github/workflows/issues.yaml) runs on
open, body/title edit, reopen, and label changes using the trusted default-branch
event commit. GitHub requires this workflow on the default branch for
[Issue events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues).
Classification changes use `labeled` and `unlabeled` events. Changes to the
diagnostic `template: invalid` label are ignored to prevent feedback recursion.
Maintainers must provision both current form labels and `template: invalid`
before deployment; missing labels or malformed forms are automation failures.

A structurally invalid typed Issue receives only the diagnostic label and one
owned GitHub Actions bot comment with field-specific repair guidance, then its
workflow reports failure. Edit the body or corresponding form label to repair
the submission. A repaired Issue loses only the diagnostic label and its existing
owned comment records resolution. Removing both form labels makes the Issue
ordinary and exempt, clears stale diagnosis, and resolves any owned comment.
Fresh valid or ordinary Issues receive no comment. Closed Issues are skipped.
Other labels, comments and the original body remain intact; automation never
closes, deletes, locks or reopens an Issue.

Ownership requires the verified [GitHub Actions bot](https://api.github.com/users/github-actions%5Bbot%5D)
numeric identity, `github-actions[bot]` login
and Bot type plus the fixed feedback marker. Comment discovery is paginated;
legacy duplicates select the lowest numeric comment ID for update and preserve
the others. Marker text copied by a contributor cannot claim a comment.
API, authentication, network, malformed response and configuration failures are
automation failures, distinct from contributor content. Logs omit tokens and
Issue bodies. The workflow queues runs per Issue and checks freshly fetched
identity, body, title, labels, state and update time before writing. Confirmed
own label mutations advance the expected update time only while source and label
identities still match. GitHub REST offers no atomic compare-and-set here; an edit
in the final request window is repaired by its later queued event.
A confirmed label write can remain if a later comment request fails. The run
reports automation failure; a rerun fetches current state and resumes recovery
without creating duplicate owned comments or changing unrelated content.

## Optional Issue and PR references

Issue association and other PR references are optional. Prefer the PR description
for visible Issue associations and regression-source explanations. When the PR
resolves an Issue, use a GitHub-supported closing keyword such as `Closes`,
`Fixes`, or `Resolves` followed by its Issue reference. Use `owner/repository#number`
for another repository. Non-closing references may use ordinary Markdown links
or references such as `#220`. The PR description does not require commit-footer
placement, one-reference-per-line formatting or blank-line separators.

Closing keywords in a PR description create a visible PR-Issue link when the PR
targets the default branch; merging that PR into the default branch closes the
Issue independently of the curated squash body. Title references are allowed;
titles alone do not close Issues. See
[GitHub's issue-linking documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

Select useful commit references independently when curating the squash message;
do not rely on copying the description. Topic commits may also carry references.
In an actual commit, use `Closes #219`, `Fixes #219`, or `Resolves #219` for an
Issue closure and `Refs: #220` for a non-closing Issue or PR reference. Put these
trailers at the end of the message, with a blank line after its header or body,
and use one reference per trailer line. All existing commit-footer rules apply.

For example, PR #123 resolves Issue #219 and fixes a regression introduced by
PR #220. Its raw title may be `fix(target): reject stale identity from #220`,
and its complete final squash message can look like this:

```text
fix(target): reject stale identity from #220 (#123)

Reject stale session identities so tools cannot route to a replaced session.
This fixes the regression introduced by PR #220.

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
