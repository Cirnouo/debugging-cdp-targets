# Release regressions

- `release-notes.test.ts` preserves dated Changelog selection, fenced examples,
  exact English bodies, generated contributors and comparison/history output.
  An unrelated-cwd Node child rejects publication and I/O imports while exercising
  both pure exports with literal expectations.
- `publication.test.ts` preserves stable, rc and arbitrary legal prerelease
  matrices, event/annotated-tag/main identity, independent App/Plugin metadata,
  paginated draft recovery, baseline selection, repeated remote checks and
  fail-closed draft/publication results. Controlled GitHub I/O and disposable Git
  repositories preserve ordered effects without live publication or repository tags.

Both suites are explicitly selected once by default and coverage commands, with
sequential files and existing coverage floors. They launch no GUI or user target.
Ancestor [test rules](../../AGENTS.md) apply;
[release owners](../../../tooling/releases/README.md) describe the production boundary.
