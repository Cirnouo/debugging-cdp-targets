# Text quality policy

- `text-policy.ts` owns pure YAML filename and text style validation, including
  exact filename and generated-lock indentation exceptions.

Root `repository-audit.ts` owns repository traversal and AST/safety checks. Root
`check-text-style.ts` owns staged file reads and complete original-release byte
verification before exemption. Both consume these rules directly.
Ancestor [tooling rules](../AGENTS.md) apply.
