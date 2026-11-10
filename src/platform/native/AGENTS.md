# Native advisory-lock ownership

Apply root, source and platform instructions cumulatively. Before changing the
native loader, independent verifier, AdvisoryLock type or their consumers, read
[ADR 0017](../../../docs/adr/0017-singleton-desktop-app.md), the
[accepted singleton plan](../../../.superpowers/plans/2026-10-17-singleton-app-plan.md)
and the [native delivery policy](../../../docs/policies/supply-chain.md).

`advisory-lock.ts` owns module-relative package resolution, complete host-neutral
verification of the original six-package source/prebuild/license closure and
the single AdvisoryLock declaration. Its exact dependencies are Node filesystem
promises, module and path, App distribution and release rules, shared errors,
the App delivery and regular-file verifiers, and reviewed `fs-native-extensions`.
The production loader checks the actual imported Windows support decision with
direct platform and architecture evidence before verifying inputs and requiring
the public addon. Keep original package bytes and verify the complete closure
before loading. Select tryLock once and preserve descriptor, exact own boolean
shared option and boolean-result validation, including the absent option call.

In `src/`, only current App Main consumes the loader VALUE. Singleton and
deployment consume only its TYPE. Tooling's builder and ordinary deployment
worker and the controlled tests retain their reviewed native edges. The native
owner imports no Desktop source. Its early support guard is the sole ambient
exception. Unknown siblings remain pure and dependencyless.
