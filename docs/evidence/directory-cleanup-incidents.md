# Directory cleanup incidents

Recorded 2026-11-09. Incident dates use UTC. Windows fixture teardown, managed
profile removal and profile-path reappearance are separate failure classes. The
recorded errors and observations establish where each failure surfaced. What
caused the removal operations to report `ENOTEMPTY` remains unknown.

## Windows cleanup failures

| Date | Test file | Recorded failure and cleanup owner |
| --- | --- | --- |
| 2026-10-17 | [`app-configuration-storage.test.ts`](../../tests/app-configuration-storage.test.ts) | The atomic replacement case reported `ENOTEMPTY` from fixture-parent removal during pre-push coverage. The later empty-directory observation and isolated pass leave the original save/assertion outcome unknown. |
| 2026-10-18 | [`host-plugin-manager.test.ts`](../../tests/host-plugin-manager.test.ts) | The replacement-resume case reported `ENOTEMPTY` at the owned 0.3.0 directory during pre-push coverage. That directory belonged to suite teardown. The test body removed the previous 0.2.0 version as a separate operation. |
| 2026-10-18 | [`verified-plugin-files.test.ts`](../../tests/host-plugins/payload-filesystem.test.ts) (historical name) | Two pre-push runs reported `ENOTEMPTY` while removing fixture roots in distinct Codex URL-overlay cases. A focused run after the first scoped change hit the same error in the Claude lease-marker case. |
| 2026-10-19 and 2026-10-20 | [`deployment-support-build.test.ts`](../../tests/deployment-support-build.test.ts) | The compiler fixture's teardown reported `ENOTEMPTY` under its owned `managed/.deployment` and `outputs` subdirectories in separate runs. The two cases exercised a deployment reader lease and a replacement reservation, respectively. [Compiler fixture](../../tests/fixtures/deployment-support.ts) |
| 2026-10-23 | [`app-fresh-stage.test.ts`](../../tests/app-fresh-stage.test.ts) | The state-publication response-loss case reported `ENOTEMPTY` under `stage/.deployment`. The path and source are consistent with final fixture teardown. The original body outcome remains unknown. [Stage fixture](../../tests/fixtures/app-stage.ts) |
| 2026-11-08 | [`deployment-support-build.test.ts`](../../tests/deployment-support-build.test.ts) | The fixed-copy stream case reported `ENOTEMPTY` during the support adapter's explicit `release()`, which removed its separately owned build scratch root. The pre-push hook stopped at coverage with 2,007 passed, 1 failed and 1 skipped. The original copy and assertion outcome is unknown because release ran in `finally`. [Support adapter](../../src/adapters/windows-deployment-support.ts) |

The configuration, Host manager and payload fixture teardowns adopted bounded
recursive removal with `maxRetries: 5` and `retryDelay: 100`. Those options
bound retries within the removal operation. Total teardown time also depends on
directory traversal and filesystem calls. The changes are fixture-specific,
and the original failures remain part of the record.

## Ubuntu real Chrome failures

| Date | CI evidence | Classification and observations |
| --- | --- | --- |
| 2026-10-18 | [PR 64 job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/39154818785/job/117757065912) | **Profile path reappeared.** Both removals and immediate absence checks succeeded. The first profile path resolved at the final absence check. The final entry's type, identity and creator are unknown. |
| 2026-10-19 | [PR 69 job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/39245744938/job/118039138884) and [PR 72 main job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/39260987629/job/118091222106) | **Profile removal failed.** Normal Close reached cleanup after target exit. Recursive removal reported `ENOTEMPTY` from `rmdir` and Close failed. Later gateway cleanup rechecked the retained lease, removed the original profile, and observed the path absent. Each first CI attempt remains a failed acceptance result. |
| 2026-10-23 and 2026-11-04 | [PR 79 main job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/39916133371/job/120291825816), [PR 81 push job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/41783732864/job/126422550985) and [PR 81 pull-request job](https://github.com/Cirnouo/debugging-cdp-targets/actions/runs/41784161808/job/126424004455) | **Profile path reappeared.** The first profile was absent after Close and immediately before the second start. The sample after the second start found a directory with a different filesystem identity from the registered first profile. It remained present at the final check. Those samples bound the interval and leave the creator unknown. |

The [Chrome smoke fixture](../../tests/smoke/official-server.ts) checks for
profile absence immediately after Close and again after gateway shutdown.
The final absence assertion remains part of acceptance even when removal and
the earlier check succeeded.

## Qualification for cleanup recovery

- Bind recovery to one cleanup owner, its authorized root and a specific
    removal error. In one controlled execution, observe an actual transient
    failure at the owner's removal boundary and recovery of that same owned
    root. Show that the failed attempt left the original identity owned and
    eligible for recovery. An injected failure can verify control flow. A
    passing rerun of the test or job establishes only non-reproduction.
- Complete and verify the owner's barriers before each destructive attempt.
    Join fixture writers, handles and child or stream completions where
    applicable. For a managed profile, verify authorization, definitive target
    exit, live and pending users, native availability and the retained lease's
    root identity. Stop on unsafe or uncertain identity, lost ownership or
    incomplete barriers. [Data directory isolation](../adr/0015-explicit-data-directory-isolation.md)
- Set a finite attempt budget and bound any wait or backoff before starting.
    Verify ordinary success, transient recovery, exhaustion and propagation
    of unrelated failures. Keep retries within the removal boundary and end
    recovery at the first successful removal. A later entry at that path
    is outside the original deletion authority. Record reappearance separately
    from the final absence result.
- Preserve the original removal error, attempt outcomes and final disposition.
    Preserve body, Close and cleanup failures separately when more than one
    occurs, including errors that a rejecting `finally` could replace. Keep
    failed runs and retained evidence available for review. Record the tested
    revision, command or job, owner, error code and syscall, identity and
    barrier outcomes, and observation limits. Redact private paths, contents
    and credentials from the published record.

## Controlled Windows experiment

On 2026-11-09, six cases passed in one isolated Node 24.21.0 run against
baseline `2b22774`. Fresh test directories returned real `ENOTEMPTY` from
`rmdir`. The candidate checked the owner's guard before every attempt and
waited 10 ms and 25 ms before at most two retries. It recovered when the test
cleared the remaining entries and preserved the final removal error when the
entries remained. A guard failure or unrelated removal error stopped at once.
Replacement directories were preserved both during backoff and after success.

The lease case exercised the checked-in directory registry, connection lease
and resource owner with controlled availability and removal. The pending
writer blocked the first release, and an overlapping claim was refused during
backoff. The existing claim stayed held until the same directory was removed.

The staged and compiler directory layouts were controlled fixtures. The
experiment did not reproduce a historical recursive `rm` race or observe
the deployed support adapter or a real Chrome process. The mechanism that
recreated earlier Chrome profile paths remains unknown.

## Shared fixture cleanup

The [test fixture helper](../../tests/fixtures/owned-directory-cleanup.ts)
binds the compiler and stage fixture roots at creation. Each fixture restores
its mocks and checks the root's parent and prefix before cleanup. The helper
checks the original identity before each attempt and keeps the removal
options supplied by the fixture. If recovery ends in failure, it reports
earlier removal errors together with the terminal reason.

The maintained tests exercise transient recovery, replacement during backoff
and exhaustion using real `rmdir` errors. Targeted integration covers ordinary
cleanup in the compiler fixture's replacement-reservation and fresh-context
reader cases and in the stage fixture's state-publication response-loss case.

The compiler and stage fixtures own writer and handle completion. The helper
checks directory identity, and removal is a separate filesystem operation.
Qualify any additional caller at its own removal boundary. The deployed
support adapter's scratch root and managed Chrome profiles keep their existing
cleanup owners.
