# Application orchestration

- `plugin-runtime.ts` owns CDP entry, controller, IPC, and official Server life.
- `target-controller.ts` sequences launch, loss, explicit recovery, disposition, and cleanup.
- `AGENTS.md` defines transaction and rollback rules.
