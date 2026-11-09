# App configuration

- [model.ts](model.ts) owns supplied schema validation, the real schema 1-to-2
    migration and complete sequential migration runner, plus desired/effective
    configuration and hot appearance/host versus cold port rules.
- [store.ts](store.ts) owns singleton-admitted load, original-byte backup and the
    complete serialized atomic save transaction, retaining state and pending work.
- [AGENTS.md](AGENTS.md) owns exact dependencies, ordering and before-edit authorities.

Main retains startup/save/Quit coordination; Host management retains its independent
job/selection cache. Selected data-root admission stays in adapters/app-storage.ts.
The complete six model and nine store regressions live in
[tests/desktop/configuration/](../../../tests/desktop/configuration/README.md).
