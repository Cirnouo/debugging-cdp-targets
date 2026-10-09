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
user changes. Finalize a dated snapshot only when preparing an authorized
publication. Package, both host Plugin/Skill metadata, and release tag must agree.

Unreleased, each prerelease snapshot, and the final stable release record meaningful
cumulative net changes relative to the latest published stable/full release, not
individual commits, the development process, or the previous prerelease. Before
the first stable publication, the baseline is an absent product: describe the
capabilities actually delivered in the initial version under Added and Security.

Consolidate repeated work on a capability into its final net change. If an
unreleased capability is withdrawn, remove its entry rather than adding Removed.
Do not include abandoned designs, internal migrations, directory cleanup, or
intermediate dependency repairs merely because they appear in Git history.
Development history remains in commits and existing ADRs. For subsequent
versions, use Changed, Removed, Fixed, and other applicable categories only when
they describe a real difference from the latest published stable/full release.

Before publishing, verify all gates, licenses, payload inventory, the exact
official Server version, and installation from the actual distribution source.
Check both complete host payloads and Marketplace pointers independently, including
their generated and maintained versions, shared licenses, unchanged official
release and host formats. A single source release contains both distributions.
Only an authorized release may create an annotated v<version> tag or GitHub
Release. Do not publish an npm package; runtime is bundled with the Plugin.

## Changelog editing workflow

Before editing `CHANGELOG.md`, read this policy and complete these steps:

1. Verify the latest published stable/full release, or verify that none exists,
    using authoritative published release evidence such as this repository's
    GitHub Releases records or releases API. Inspect enough of the published
    history to establish the baseline; exclude drafts and prereleases. Git
    commits, local tags, prereleases, and prepared dated changelog entries alone
    do not establish that a stable/full release was published. Resolve uncertain
    publication status before selecting categories.
2. Compare the final delivered behavior with that verified baseline. Before the
    first stable publication, use the absent-product baseline and describe the
    final cumulative capabilities under Added and Security. Do not categorize
    internal unreleased iterations as Changed, Fixed, or Removed. After stable
    publication, select categories for the meaningful net difference from the
    latest published stable/full release, including when preparing prereleases.
3. Consolidate existing Unreleased entries for the same capability into its
    final net behavior. Withdraw an entry if the unreleased capability is removed;
    keep already-published snapshots unchanged. Internal process changes do not
    need a changelog entry merely because they change contributor instructions.
4. In the PR `Verification` section, record the baseline version or verified
    absence, the authoritative evidence inspected, and why the selected
    categories describe the net user-facing change. Include remaining limits;
    passing repository checks alone does not verify this semantic judgment.

For example, before the first stable release, support for existing stable Node
installations `>=24.21.0 <25` belongs under Added even if a development pin
previously required one exact Node version. Describe the final supported range;
the unreleased pin adjustment is development history, not a Changed entry.

## Tag-triggered GitHub publication

Preparing and pushing an explicitly authorized, annotated `v<semver>` tag without
build metadata triggers automatic publication for stable versions and prereleases.
Before creating it, finalize matching Package, Plugin and Skill versions and exactly
one nonempty `## [<version>] - YYYY-MM-DD` Changelog entry with a valid ISO date,
and complete installation acceptance from the actual distribution source.
The tagged commit must already be merged into main. Enabling the workflow
does not itself authorize the first 0.1.0 publication, which remains unreleased.

The Release workflow calls the full CI at the tagged commit and publishes only
after all security, governance, quality, Windows and portable checks succeed.
It additionally verifies annotated-tag, checkout, event and remote tag identity,
including the original pushed tag object, main ancestry and version/Changelog
agreement. The workflow admits stable three-component tags and prerelease
candidates; the publisher strictly validates SemVer before release API operations.
Core and numeric prerelease identifiers have no leading zeros. Build metadata,
updated/deleted/forced tags and manual runs do not publish. Generic metadata audits
accept agreeing SemVer versions rather than pinning future development to 0.1.0.

Release titles equal their tags. English notes display What's Changed using
the corresponding Changelog entry's original categories and Markdown, followed
by generated New Contributors when available and Full Changelog. Do not append
the generated PR change list. Comparisons use the latest published stable/full
release; without that baseline, use the current tag's commit history.

Publication creates a draft first, resumes a matching draft on rerun and skips
an already-published matching release only after checking its expected prerelease
classification and remote tag identity, without rewriting its notes. Draft updates
set the intended classification, and returned draft and published records must
match the tag, draft state and classification. Stable publication uses
`prerelease: false` and `make_latest: legacy`; prereleases use `prerelease: true`
and `make_latest: false`, preserving GitHub's latest stable release. API or
validation failures stop publication and never trigger destructive cleanup.
Same-tag publication runs queue. Provide only GitHub's source ZIP/TAR.GZ;
there are no additional assets, checksums or npm publications.

Prerelease labels may be any legal SemVer identifiers; there is no label whitelist
or required stage sequence. Prefer familiar `alpha.N`, `beta.N`, and `rc.N` labels.
Successive prerelease versions should increase SemVer precedence during preparation;
this policy does not add automated version bumps or precedence comparisons.
Promoting a prerelease requires a new stable version, annotated tag and release,
with separate explicit authorization. Every release category has the same complete
tag, metadata, CI, license and actual-source installation acceptance gates.
Enabling prerelease support does not authorize any publication.

Before prerelease publication, copy current cumulative Unreleased changes into an
immutable dated snapshot while retaining those changes in Unreleased. Before stable
publication, archive the final cumulative net changes and remove delivered entries
from Unreleased. Retain historical prerelease entries. A capability withdrawn while
still unreleased is removed from current cumulative notes, while historical snapshots
remain unchanged. The publisher reads only the finalized dated entry and never edits
the Changelog. Every release comparison uses the latest published stable/full release;
when none exists, use the absent-product baseline and the current tag's commit history,
even if prereleases already exist.

A GitHub prerelease does not create an independent Marketplace channel. Existing
repository-based Codex and Claude Code Marketplace installation remains unchanged.

Enable repository release immutability once before the first publication.
CI intentionally neither reads nor validates this setting and uses only its
built-in GITHUB_TOKEN, with no additional secret. GitHub immutability locks
published tags and assets; titles and release notes remain editable on GitHub.
Changing the repository setting still requires explicit user authorization.
