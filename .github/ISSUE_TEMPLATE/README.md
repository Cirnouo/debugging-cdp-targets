# Issue forms

- `bug_report.yml` collects Plugin host/version, environment, reproduction, behavior, and redacted
  diagnostics for a bug.
- `feature_request.yml` collects the problem, proposed behavior, and alternatives.
- `config.yml` preserves ordinary issues and links to private security reporting.

The YAML forms own generated H3 field labels, order, required answers, dropdown
options, and their `template: bug-report` or `template: feature-request` label.
Provision those labels before using the forms so GitHub applies them on creation.
Agents submitting through another interface apply the corresponding form label.
When editing, keep every generated field heading, including optional fields;
optional answers may remain empty or `_No response_`.

Only the corresponding form label classifies a typed Issue. Both labels are
ambiguous; an ordinary freeform Issue without either label stays exempt.
`template: invalid` is reserved for diagnostics. See the
[typed Issue policy](../../docs/policies/commits-and-scope.md#typed-issue-submissions)
for structural requirements and supported control types.

Report vulnerabilities through SECURITY.md, not a public issue form.
