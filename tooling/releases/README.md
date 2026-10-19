# Release tooling

- `release-notes.ts` owns supplied-string Changelog selection and English release
  body construction. It preserves original Markdown and generated new contributors
  without importing publication, filesystem, process, network or metadata code.
- `publish-release.ts` owns the complete explicit publication transaction: input,
  event and annotated-tag identity; Git/main ancestry and remote-object checks;
  App and independent peer Plugin/Skill metadata and license validation; stable
  baseline selection; generated notes; draft creation/resume and final publication.
  Its guarded CLI is invoked by the authorized Release workflow.

Before release preparation, tagging or publication, follow the root-triggered
[release policy](../../docs/policies/releases.md). Publication requires separate
authorization; 0.1.0 remains Unreleased. Ancestor [tooling rules](../AGENTS.md) apply.
[Central regressions](../../tests/tooling/releases/README.md) cover both owners.
