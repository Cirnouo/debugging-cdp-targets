# Application orchestration

- `plugin-runtime.ts` owns the gateway registry, independent target connections,
  control IPC, monitoring and official Server lifetimes.
- `target-controller.ts` sequences launch, loss, explicit recovery, disposition, and cleanup.
- `AGENTS.md` defines transaction and rollback rules.
