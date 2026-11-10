# Desktop process-instance resources

- [singleton.ts](singleton.ts) owns the native-account coordination paths and
    the advisory descriptor retained until actual process exit.
- [activation.ts](activation.ts) owns the bounded activation exchange and
    winner-only listener.
- [chromium-storage.ts](chromium-storage.ts) owns synchronous per-process
    Chromium scratch creation, rollback and cleanup.

The [bootstrap](../main/README.md) redirects Chromium paths before importing
[App Main](../../interface/README.md). The
[instance regressions](../../../tests/desktop/instance/README.md) retain the
original behavior cases. Follow the cumulative [instructions](AGENTS.md).
