# Gateway tests

- `owned-tool-arguments.test.ts` preserves explicit lifecycle bearer extraction,
    nonmutation, official route removal, original argument identity and malformed
    input refusal. Its fixtures are local literals; no I/O is required.

- `connections/` owns construction and retained Gateway cleanup cases alongside
    twenty directory lifetime and five explicit operation evidence cases, plus
    32 whole managed/options cases grouped by their observable ownership contracts, over the
    real Core/DataDirectoryRegistry and controlled I/O.
- `targets/` owns twelve explicit suites for supplied endpoint identity, pure
    launch/isolation/native argument values, controlled profile/launch effects and
    the complete target lifecycle. Directory admission keeps its two complete
    pre-acquisition cases. See its [suite map](targets/README.md).

- `official/` owns supplied options/execution/argument contracts and complete
    package-file proof and resolver regressions under its [suite map](official/README.md).

Both default and coverage commands select all twenty-eight exact suites once. HTTP admission
remains in the root `mcp-http-policy.test.ts`; live authentication, continuation
and execution remain covered by their existing integration suites.
