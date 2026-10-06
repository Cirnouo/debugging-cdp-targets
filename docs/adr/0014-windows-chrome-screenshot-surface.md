# 0014 — Fixed Windows Chrome screenshot surface

Status: accepted for unreleased 0.1.0. Extends the Chrome launch preset while
retaining [0011](0011-mcp-native-lifecycle.md) official routing/quarantine and
[0013](0013-session-owned-exit-cleanup.md) ownership, port and restart rules.

## Context and evidence

Users need screenshot capture while normally switching windows or minimizing
Chrome. The controlled 2026-10-07 Windows Chrome 154.0.8037.98 comparison produced
correct candidate captures in all six foreground-normal/background-normal/
minimized viewport/fullPage combinations. Minimized viewport baseline timed out
and candidate succeeded on fresh targets in both acquisition orders. Both
background baseline modes and minimized fullPage baseline already succeeded.
All fourteen acquisitions retained valid native evidence and normal cleanup.
See [the dated record](../mcp-native-validation.md#controlled-chrome-window-state-follow-up-2026-10-07)
for identities, counts, exact intervals and limits. This does not establish the
historical Codex-click timeout's cause or every transition during capture.

`CDPScreenshotNewSurface` is a Chromium application feature, disabled by default
in the reviewed
[154.0.8037.98 definition](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/content/common/features.cc).
The setting belongs in application launch arguments. It is not a universal MCP
or CDP request option. Generic applications may expose different argument or
environment carriers; no framework name establishes compatible forwarding.

## Decision

Apply the fixed rule only to Windows `targetKind: "chrome"`, through the existing
Chrome preset before profile acquisition or application spawn. Insert one
canonical `--enable-features=CDPScreenshotNewSurface` before the first exact
`--`, append the bare name to one accepted canonical enable list, or preserve
one existing bare occurrence. A pure helper copies the caller array, preserves
valid unrelated entry/parameter bytes and positional tails, and is idempotent.

Reject conflicting or ineffective input with an actionable error rather than
deleting a user's disable, rewriting ambiguous lists or offering an opt-out of
the fixed rule. The existing allocator can claim/probe a port first; rejection
releases that claim and acquires no profile or application. Generic targets and
non-Windows Chrome retain their existing launch semantics. The measured browser
version bounds acceptance evidence; no prelaunch version gate is introduced.

## Feature input contract

Only arguments before the first exact `--` participate in composition. All later
arguments remain positional and unchanged. Windows Chromium trims arguments
before switch/terminator recognition, as established by
[command_line.cc](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/command_line.cc),
[string_util.cc](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/strings/string_util.cc)
and [whitespace_constants.h](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/strings/whitespace_constants.h).
Recognition uses that exact set: U+0009–000D, U+0020, U+0085, U+00A0, U+1680,
U+2000–200A, U+2028/U+2029, U+202F/U+205F/U+3000. NEL is included; FEFF is not.
Reject whitespace-padded effective terminators or relevant switches, preserving
FEFF-prefixed positional tokens rather than treating them as native whitespace.

Allow at most one exact `--enable-features=<value>` and one exact
`--disable-features=<value>` token in the effective region. Relevant alternate
prefixes/case, whitespace, duplicate switches and separate-value forms fail.
Effective Windows `single-argument` forms also fail; the policy conservatively
rejects their ASCII case variants. The native special boundary is lowercase in
the reviewed command-line implementation and its
[official test](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/command_line_unittest.cc).
These rejections are deliberately stricter than native duplicate/prefix parsing.

Relevant feature values must be ASCII. Chrome reads them through an ASCII
accessor in
[variations_field_trial_creator.cc](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/components/variations/service/variations_field_trial_creator.cc);
non-ASCII input can discard the complete value. The error asks for valid ASCII
feature names/values. Other Unicode argv remains intact. Existing `%NAME%` and
`${NAME}` structured-field expansion remains unchanged; percent encoding is
not a prescribed workaround for this launch surface.

Validate every nonblank enable entry before adding or retaining the target.
Native enable parsing splits `:` over the whole entry, then `.` over the trimmed
prefix before `:`, then `<` over the trimmed prefix before `.`. Empty stage input
or a repeated separator in that stage fails before assigning the complete enable
list. Blank comma entries are ignored for validation and their bytes remain
preserved. See
[feature_list.cc](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/feature_list.cc)
and [string_split_internal.h](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/strings/string_split_internal.h).
Thus `Other:one/two:three/four`, `:value`, `.Group`,
`Other.Group.More:param/value` and `Other<Trial<Again.Group:param/value` are
rejected even when a bare target already exists elsewhere in the list.
Periods and `<` in the parameter remainder remain preserved. Later slash
parameter association is separate, as shown by
[field_trial_params.cc](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/metrics/field_trial_params.cc);
the helper adds no blanket validation for that later grammar or unrelated
disable-entry grammar.

The target name is case-sensitive and must occur exactly once as the bare
`CDPScreenshotNewSurface`. Reject its surrounding whitespace, default `*`,
trial/group/parameter decorations, spaced decorations and duplicate occurrences.
The documented native enable forms and default marker are described in
[feature_list.h](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.98/base/feature_list.h).
Any effective disable entry naming the target is a conflict. Native disables
take precedence over enables; the policy also rejects target-shaped disable
decorations conservatively. Native disable parsing does not interpret every
rejected dot/colon decoration as an equivalent disable. Differently cased feature
names remain unrelated because the native map keys are case-sensitive.

## Consequences and verification boundary

Exact live restart reuses the composed argv without adding another feature or
altering other bytes. Changing application args still requires completed normal
Close and a new start. Fixed profile, loopback, updater, native identity,
authorization/readiness, timeout/quarantine and explicit recovery rules remain.
Official tool names, arguments and results retain transparent `_dct` routing.
Product capture adds no focus/window mutation, replay or automatic restart.

Raw screenshot A/B experiments cannot compare two Windows Chrome preset arms.
Their validator refuses that target kind before acquisition; a documented
experimental generic route with actual Chrome identity or a genuine retained
pre-change payload provides a raw comparison. This test-only route is not a
generic product preset or user configuration knob.

Focused domain/host/raw-fixture regressions cover composition, native whitespace,
whole-list failure, exact tails, immutability, restart and conflict rollback. They
establish source behavior through injected boundaries, not a new native browser
measurement. Generated-payload and actual no-supplied-feature preset acceptance
are separate gates. Static native samples cannot prove continuous compositor
occlusion, arbitrary in-flight transitions or other application/version/platform
compatibility; normal user window switching remains supported usage.
