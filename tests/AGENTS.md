# Test rules

Develop changed domain behavior test-first and observe focused failures before
implementation. Use literal identity fixtures and test actual observable
effects. Replace external process/daemon operations only at their I/O boundary.
Keep all tests outside the Skill payload. Do not launch or close real user
targets or download packages in the regression suite.
Keep all migrated regressions in strict TypeScript; typecheck includes tests,
fixtures and opt-in smoke tools. Validate protocol/output JSON from `unknown`.
Do not replace adversarial runtime tests with casts or type-error suppression.

The delivered official Server 1.10.1 refuses `chrome://version/` through
`new_page` and `navigate_page`, and filters that page from its page inventory even when
opened at startup. Official-tool I/O fakes must model this restriction. The
test-only native profile probe may inspect only a newly launched, independently
verified owned Chrome fixture on its exact loopback endpoint. It never extends
the public tools, delivered Server or user workflow.
