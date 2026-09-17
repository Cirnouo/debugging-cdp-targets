# CDP, session, cache, privacy, and security

The runtime manages one newly launched target and one verified DevTools daemon
per Windows user. State is fixed at
`%LOCALAPPDATA%\debugging-cdp-targets\state\session.json`; the isolated CLI
runtime is under `%LOCALAPPDATA%\debugging-cdp-targets\cache\chrome-devtools-cli`.
The Chrome profile remains separate under
`%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile`.

Preserve all of these boundaries:

- Bind CDP to loopback and verify target path, creation time, Windows session,
  listener ownership, product, version endpoint, and WebSocket identity.
- Bind the daemon to PID, exact package version, browser URL, adapter capability,
  workspace set, and disabled usage-statistics/CrUX switches.
- Never attach to, close, replace, or take over a pre-existing or mismatched
  process. Never force-kill. Normal close failure remains recoverable state for
  manual closure.
- Reconcile disappearance only when root-process and listener absence are both
  proven. Never start a replacement target during Resume or Invoke.
- Keep extension tools opt-in and Chrome-only behind capability gates. Reject all
  PWA category spellings.
- Persist only approved session identity. Never persist launch arguments,
  headers, cookies, secrets, page data, user input, or tool calls/results.

Deleting the CLI cache does not reset session state and causes a fresh verified
package download on a later Start. Never use state or cache deletion as a live
session recovery shortcut. A kept target retains a loopback CDP listener that
other local processes can reach; disclose that consequence to the user.
