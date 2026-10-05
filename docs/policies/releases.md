# Versions and releases

0.1.0 is an unreleased initial-development version, not a published release.
Do not invent a release date or bump it merely because pre-release design
changes. The first publication requires explicit user authorization.

Use [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) major.minor.patch.
Zero-major versions are development interfaces; after publication make
incompatible workflow changes intentionally with a
minor bump. Compatible fixes increment patch; compatible new features increment
minor; stable public breaking interfaces increment major. Published versions
are immutable. Prereleases use hyphen identifiers and build metadata uses plus
identifiers. Core version numbers and numeric prerelease identifiers have no
leading zero.

[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) uses Unreleased
first, dated releases newest first, ISO dates, and
Added/Changed/Deprecated/Removed/Fixed/Security groups containing meaningful
user changes. Move entries to a dated version only when releasing. Package,
both host Plugin/Skill metadata, and release tag must agree.

Each version records meaningful net changes relative to the previous published
version, not individual commits or the development process. Unreleased always
uses the latest published version as its baseline. Before the first publication,
the baseline is an absent product: describe the capabilities actually delivered
in the initial version under Added and Security.

Consolidate repeated work on a capability into its final net change. If an
unreleased capability is withdrawn, remove its entry rather than adding Removed.
Do not include abandoned designs, internal migrations, directory cleanup, or
intermediate dependency repairs merely because they appear in Git history.
Development history remains in commits and existing ADRs. For subsequent
versions, use Changed, Removed, Fixed, and other applicable categories only when
they describe a real difference from the previous published version.

Before publishing, verify all gates, licenses, payload inventory, the exact
official Server version, and installation from the actual distribution source.
Check both complete host payloads and Marketplace pointers independently, including
their generated and maintained versions, shared licenses, unchanged official
release and host formats. A single source release contains both distributions.
Only an authorized release may create an annotated v<version> tag or GitHub
Release. Do not publish an npm package; runtime is bundled with the Plugin.

## Tag-triggered GitHub publication

Preparing and pushing an authorized, annotated `v<major>.<minor>.<patch>` tag
triggers automatic publication. Before creating it, finalize matching Package,
Plugin and Skill versions, move the intended Unreleased changes into exactly
one nonempty `## [<version>] - YYYY-MM-DD` Changelog entry with a valid ISO date,
and complete installation acceptance from the actual distribution source.
The tagged commit must already be merged into main. Enabling the workflow
does not itself authorize the first 0.1.0 publication, which remains unreleased.

The Release workflow calls the full CI at the tagged commit and publishes only
after all security, governance, quality, Windows and portable checks succeed.
It additionally verifies annotated-tag, checkout, event and remote tag identity,
including the original pushed tag object, main ancestry and version/Changelog
agreement. Stable three-component versions
have no leading zeros; prereleases, build metadata, updated/deleted/forced tags
and manual runs do not publish. Generic metadata audits accept agreeing SemVer
versions rather than pinning all future development to 0.1.0.

Release titles equal their tags. English notes display What's Changed using
the corresponding Changelog entry's original categories and Markdown, followed
by generated New Contributors when available and Full Changelog. Do not append
the generated PR change list. Comparisons use the previous latest published
full release; first publication links to the current tag's commit history.

Publication creates a draft first, resumes a matching draft on rerun and skips
an already-published matching release without rewriting its notes. API or
validation failures stop publication and never trigger destructive cleanup.
Same-tag publication runs queue. Provide only GitHub's source ZIP/TAR.GZ;
there are no additional assets, checksums or npm publications.

Enable repository release immutability once before the first publication.
CI intentionally neither reads nor validates this setting and uses only its
built-in GITHUB_TOKEN, with no additional secret. GitHub immutability locks
published tags and assets; titles and release notes remain editable on GitHub.
Changing the repository setting still requires explicit user authorization.
