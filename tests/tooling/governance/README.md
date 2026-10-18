# Commit governance regressions

- `commit-grammar.test.ts` checks independent literal types/scopes, branch and
  release grammar, and import isolation from commit execution.
- `commit-validation.test.ts` checks config wiring, real commitlint messages,
  topology-only merge bypass and controlled raw-stdin/process-failure contracts.
- `commit-events.test.ts` checks supplied event/ref construction, literal identity
  matrices, unchanged event bytes and import isolation from execution dependencies.
- `commit-history.test.ts` checks real Git ranges/topology, forced-push and shallow
  history, actual commitlint parity, current PR templates and original message bytes.
  Disposable Git fixtures retain environment isolation and normal cleanup.

All four are explicit safe default/coverage inputs. No GUI or network acceptance
runs here.
