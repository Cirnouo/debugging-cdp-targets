# Workflow rules

Keep Status read-only. Acquire the per-user lock before public mutations.
Reconcile only explicit root-process absence and an empty listener snapshot.
Inspect the daemon, stop only a fully matching daemon, verify its absence, then
remove state. Any mismatch or unverifiable result retains state and fails closed.

Resume and pre-Invoke absence report TARGET_EXITED and sessionCleared true;
pre-Invoke includes toolMayHaveExecuted false. Post-Invoke absence reports
TARGET_EXITED_DURING_INVOKE, sessionCleared true, and toolMayHaveExecuted true,
including when the tool call itself threw. Never launch a replacement target.

Keep external boundaries injectable for tests. Preserve recovery identity when
rollback, normal close, or state persistence fails.
