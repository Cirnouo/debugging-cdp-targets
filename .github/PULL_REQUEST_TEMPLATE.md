## Problem

Describe the problem or link the relevant issue.

## Resulting behavior

Explain the final change and any compatibility or security implications.

## Verification

List the checks actually run and their results. Identify any remaining
verification limits, including real-platform checks.

- [ ] Focused tests and `pnpm verify:push` pass.
- [ ] Dependency or build-input changes passed `pnpm check:security`, when applicable.
- [ ] Runtime source changes include verified regenerated distribution output, when applicable.

## Documentation

- [ ] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.
- [ ] The PR title and commits follow the repository policy.
- [ ] Version 0.1.0 remains unreleased.

<!--
Write this description for Markdown readability and review, explaining the important What/Why.
Keep that meaning aligned with the final squash message; wording and format may differ.
Commit body/footer line-width and separator rules do not apply to this description.
Checks, results, review notes and screenshots may remain specific to the PR.
Use deeper headings within the existing sections for review notes; preserve all H2 sections.
Prefer this description for visible Issue associations and regression-source explanations.
Use Closes #ISSUE, Fixes #ISSUE, or Resolves #ISSUE when this PR resolves an Issue.
GitHub closing keywords link/close Issues when this PR targets/merges into the default branch,
independently of the squash body. Description references need no commit-footer formatting.
Use ordinary Markdown links or #NUMBER for non-closing Issue or PR references.
Use owner/repository#NUMBER for another repository.
Authored #number or (#number) title references may identify Issues or other PRs.
The raw title must not end in its own (#CURRENT-PR-NUMBER); GitHub appends that suffix.
Both the raw title and final header with the actual PR suffix must satisfy the header rules.
The required GitHub default is PR_TITLE + BLANK; the merge author must curate the actual body.
Explain the important What/Why and How when needed without copying the full PR description.
No literal What:/Why: labels are required. Actual commits retain all commitlint rules.
Compare the final header to the validated title plus actual PR suffix and validate the exact
complete candidate through raw stdin before merging; --edit parsing can strip comment lines.
Select useful commit references independently and follow commit-footer grammar there.
See docs/policies/commits-and-scope.md for reference and squash-message conventions.
-->
