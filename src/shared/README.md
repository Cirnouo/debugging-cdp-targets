# Shared invariants

- `client-context.ts` defines the cross-layer originating-client contract using
    erased public SDK types, with no runtime imports or I/O.
- `constants.ts` owns cross-layer limits, target kinds, disposition values,
  loopback defaults, and the exact official Server package version.
- `AGENTS.md` prevents this layer from becoming an unowned utility collection.
- `errors.ts` owns validated unknown-value guards and structured error details.
- `environment-key.ts` matches supplied environment keys for target expansion and
    Official boolean settings: last Windows case match, POSIX exact membership,
    including undefined values. It reads no host environment.
- `payload-path.ts` validates supplied portable payload-relative component syntax
    without I/O; it does not prove filesystem containment or Official provenance.
