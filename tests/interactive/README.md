# Interactive Windows tests

Run `pnpm test:windows:interactive --allow-gui` from an interactive Windows desktop.
The native TypeScript runner uses `node:test.run` with concurrency 1 and forwards
argv to these files. Without the exact `--allow-gui` parameter the command returns
a visible successful skip before selecting files, and direct `node --test`
invocations skip every individual case. CI/environment variables and platform or
display detection never authorize execution. After authorization each file fails
on non-Windows. Windows CI explicitly passes the flag after typecheck alongside
the default regression lane. Developing, modifying and verifying these tests
locally may opt in explicitly; ordinary local hooks and scripts stay GUI-free.
These tests compile and launch owned disposable WinForms or raw Win32 fixtures
and request normal Close with actual-exit evidence. The normal-Close test forwards
`-AllowGui` to its PowerShell fixture only inside an authorized test callback.
Window evidence mutation calls also forward `-AllowGui` only from the explicit
CLI permission; passive None samples omit it.

- `windows-native.test.ts` retains three cases for visible launch, delayed normal
    close and manifest inspection, owned process/listener/endpoint discovery, and
    short-path close identity. The short-path case keeps its conditional skip when
    the fixture filesystem provides no 8.3 alias.
- `window-evidence.test.ts` retains four cases for guarded NOACTIVATE background
    transitions, Unicode executable/title evidence, and minimize/restore with long
    and short executable identities. The short identity requires a real 8.3 alias.
- `screenshot-background-anchor.test.ts` retains one case proving opaque anchor
    containment and foreground handoff with normal cleanup of both owned fixtures.
- `windows-normal-close.test.ts` adds ten cases for first ordinary GUI selection,
    a real MainWindowHandle event-target misselection, minimized/transparent/
    frameless compatibility, zero-area/tool/disabled/owned exclusions and first-only
    delivery with multiple ordinary windows. Every owned fixture has normal timer
    expiry, and its driver waits for actual exit even after failure.

These eighteen cases share the inherited desktop and its single foreground window.
Concurrent file execution can invalidate another fixture's native observation.
Preserve sequential execution, native identity checks, assertions and deadlines.
The root [test inventory](../README.md) describes the default lane and shared
fixtures; this directory reuses `../fixtures/` and `../smoke/` inputs.
