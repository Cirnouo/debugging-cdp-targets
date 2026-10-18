# Target endpoint admission regressions

- `port-and-endpoint-admission.test.ts` preserves the supplied-evidence identity
    case: accepted browser product, foreign listener owner, exposed listener and
    wrong endpoint port. It opens no listener and launches no target.

Both default and coverage commands select this exact suite once. The two original
candidate-chooser cases remain in root `plugin-runtime.test.ts`, including reserved
ranges, candidate order, the privileged-port floor and exhaustion. Actual port
claim/exit ownership remains covered by the existing lifecycle/adapter suites.
