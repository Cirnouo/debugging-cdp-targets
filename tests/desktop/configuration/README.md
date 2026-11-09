# Configuration regressions

- [model.test.ts](model.test.ts) preserves all six supplied-value cases: real schema
    1-to-2 migration, defaults, invalid/current schema, synthetic sequential runner,
    intermediate rejection and hot/cold desired/effective state.
- [store.test.ts](store.test.ts) preserves all nine filesystem cases: singleton
    admission, exact backup/whole-chain commit, intermediate refusal, hot/cold save,
    malformed/future input, invalid save, backup collision and atomic failure/recovery.

Every original matrix, callback assertion, owned temporary fixture and cleanup is
retained. Synthetic schema 3 is runner evidence only. Both safe package commands
select these two whole suites explicitly, with existing sequential files and floors.
