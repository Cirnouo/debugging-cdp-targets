# Releases

This project follows Semantic Versioning. The first public version is `0.1.0`;
while the major version is zero, any incompatible public workflow or state
contract change requires an intentional minor-version decision.

Maintain `CHANGELOG.md` using Keep a Changelog, newest release first, with an
`[Unreleased]` section and Added, Changed, Deprecated, Removed, Fixed, and
Security categories. Move shipped entries into a dated version section and keep
comparison links current.

Before a release, verify the runtime, coverage floors, repository policy,
distribution payload, metadata version, both MIT licenses, and installation from
the intended source. A release version must agree across Skill metadata, package
metadata when present, changelog, and tag.

Never create or push a tag, publish a package or Skill, create a hosted release,
or modify remote settings without explicit authorization. When authorized, use
an annotated `v<version>` tag only after all release gates pass.
