# Interactive Windows tests

Run `pnpm test:windows:interactive` explicitly from an interactive Windows desktop.
The command runs these files sequentially with `--test-concurrency=1`; each file
fails on non-Windows. The Windows CI job runs this lane after typecheck alongside
the default regression lane. These tests compile and launch owned disposable
WinForms fixtures and request normal Close with actual-exit evidence.

- `windows-native.test.ts` retains three cases for visible launch, delayed normal
    close and manifest inspection, owned process/listener/endpoint discovery, and
    short-path close identity. The short-path case keeps its conditional skip when
    the fixture filesystem provides no 8.3 alias.
- `window-evidence.test.ts` retains four cases for guarded NOACTIVATE background
    transitions, Unicode executable/title evidence, and minimize/restore with long
    and short executable identities. The short identity requires a real 8.3 alias.
- `screenshot-background-anchor.test.ts` retains one case proving opaque anchor
    containment and foreground handoff with normal cleanup of both owned fixtures.

These eight cases share the inherited desktop and its single foreground window.
Concurrent file execution can invalidate another fixture's native observation.
Preserve sequential execution, native identity checks, assertions and deadlines.
The root [test inventory](../README.md) describes the default lane and shared
fixtures; this directory reuses `../fixtures/` and `../smoke/` inputs.
