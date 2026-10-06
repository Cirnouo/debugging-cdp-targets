# Security policy

## Supported versions

Version 0.1.0 is under development and has not been released. There are no
published, supported versions yet. Reports about the current development
version are welcome.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Cirnouo/debugging-cdp-targets/security/advisories/new)
to report a suspected vulnerability privately. Please avoid publishing exploit
details in a public issue or pull request before coordinated disclosure.

Include the affected commit or Plugin version, operating system, Plugin host
(Codex or Claude Code) and host version,
target application and version, reproduction steps, expected and actual
behavior, and the security impact. A minimal proof of concept is useful.
Remove cookies, tokens, private page contents, personal paths, and other secrets
from examples and diagnostics. Describe the conditions needed for exploitation,
including any local access or permissions.

The maintainer will make a best effort to acknowledge and assess reports
promptly, discuss remediation, and coordinate disclosure with the reporter.
There is no guaranteed response or remediation deadline.

## Security boundaries

The Plugin launches and verifies its own local targets, requires loopback CDP
endpoints, and preserves explicit connection and session identities. Browser
profiles retain browser data after Close. See the
[privacy guide](docs/user-guide/privacy.md) and [workflow](docs/user-guide/workflow.md)
for user guidance, the [runtime security policy](docs/policies/security.md)
for implementation boundaries, and the [supply-chain policy](docs/policies/supply-chain.md)
for dependency verification and audit coverage.

Dependency alerts and audits do not cover every vulnerability. In particular,
the official Server includes embedded libraries outside its declared npm graph.
Their maintained release evidence and original notices are preserved, but npm
graph audits do not establish vulnerability coverage for that embedded code.
