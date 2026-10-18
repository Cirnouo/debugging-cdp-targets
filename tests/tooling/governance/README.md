# Commit governance regressions

- `commit-grammar.test.ts` checks independent literal types/scopes, branch and
  release grammar, and import isolation from commit execution.
- `commit-validation.test.ts` checks config wiring, real commitlint messages,
  topology-only merge bypass and controlled raw-stdin/process-failure contracts.

Both are explicit safe default/coverage inputs. Root `commit-checks.test.ts`
retains Git/event integration; no GUI or network acceptance runs here.
