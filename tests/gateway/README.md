# Gateway tests

- `owned-tool-arguments.test.ts` preserves explicit lifecycle bearer extraction,
    nonmutation, official route removal, original argument identity and malformed
    input refusal. Its fixtures are local literals; no I/O is required.

Both default and coverage commands select this exact suite once. HTTP admission
remains in the root `mcp-http-policy.test.ts`; live authentication, continuation
and execution remain covered by their existing integration suites.
