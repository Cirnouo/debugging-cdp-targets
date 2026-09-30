# Versions and releases

0.1.0 is an unreleased initial-development version, not a published release.
Do not invent a release date or bump it merely because pre-release design
changes. The first publication requires explicit user authorization.

Use SemVer major.minor.patch. Zero-major versions are development interfaces;
after publication make incompatible workflow changes intentionally with a
minor bump. Compatible fixes increment patch; compatible new features increment
minor; stable public breaking interfaces increment major. Published versions
are immutable. Prereleases use hyphen identifiers and build metadata uses plus
identifiers; numeric identifiers have no leading zero.

Keep a Changelog uses Unreleased first, dated releases newest first, ISO dates,
and Added/Changed/Deprecated/Removed/Fixed/Security groups containing meaningful
user changes. Move entries to a dated version only when releasing. Package,
Plugin, Skill metadata, and release tag must agree.

Before publishing, verify all gates, licenses, payload inventory, the exact
official Server version, and installation from the actual distribution source.
Only an authorized release may create an annotated v<version> tag or GitHub
Release. Do not publish an npm package; runtime is bundled with the Plugin.
