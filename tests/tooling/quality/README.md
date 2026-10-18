# Text quality regressions

- `text-policy.test.ts` checks style and exact YAML/lock exceptions plus import
  isolation from filesystem, process and AST parser dependencies.

The suite is an explicit safe default/coverage input. Root
`repository-audit.test.ts` retains temporary-Git traversal and AST/owned-child
assertions; `hook-isolation.test.ts` retains real staged filename and independently
verified original-release exemption fixtures.
