# Gateway tests

- `owned-tool-arguments.test.ts` preserves explicit lifecycle bearer extraction,
    nonmutation, official route removal, original argument identity and malformed
    input refusal. Its fixtures are local literals; no I/O is required.

- `targets/` owns the supplied-evidence listener/endpoint admission suite;
    candidate chooser and mutable target ownership cases keep their root owners.

Both default and coverage commands select each of these two exact suites once. HTTP admission
remains in the root `mcp-http-policy.test.ts`; live authentication, continuation
and execution remain covered by their existing integration suites.
