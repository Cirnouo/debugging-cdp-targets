# Gateway Core fixtures

- `core-runtime.ts` retains createCoreFixture, createConnectionRuntimeFixture and
    connectionStatus over the real Core, explicit authenticated request facilities
    and controlled host/router/official I/O. It also owns the complete
    createManagedConnectionFixture and boundedManagedResult support shared by the
    five managed-connection suites. Keep all counters, support assertions,
    onCreated/exit branches, late outcomes and cleanup; no regression-case bodies
    or copied production rules belong here. Directory and target-host fakes remain
    distinct with their current fixture owners.
