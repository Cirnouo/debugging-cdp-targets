# Supply-chain audit tooling

- `lock-inventory.ts` validates every pnpm YAML document and registry identity,
  configuration dependencies and complete importer/snapshot references. It also
  owns deterministic lock-evidence canonicalization, preserving arrays.
- `registry-reports.ts` validates closed vulnerability/signature reports against
  the independently derived full inventory, including coverage and exit status.
- `vulnerability-reviews.ts` owns scoped findings, the pure Fingerprints shape,
  exact bounded exceptions and review decisions. Review time is required input;
  UTC parsing uses only supplied evidence. Dependency/exception versions retain
  shared strict SemVer limits and arbitrary legal prerelease/build identities.
- `installation-policy.ts` owns the frozen installation policy and supplied-value
  configuration refusals, without file, process or network reads.
- `installed-tree.ts` retains manifest/lock and included development/optional
  graph comparison with the complete actual installation read transaction.
- `fingerprints.ts` retains sorted path/byte-length/content SHA-256 framing and
  the descriptor-backed regular-file reader shared with release verification.
  It imports the pure Fingerprints shape from vulnerability reviews as TYPE.
- `dependency-scan.ts` owns shell-free bounded pnpm calls, repository preflight
  and one disposable upstream workspace/config/store lifetime. Frozen lock-only
  validation and complete audits precede review; review precedes actual install.
  All pnpm calls disable pnpmfile hooks and configuration-dependency loading.
- `check-security.ts` owns Git-derived code/configuration selection and the full
  initial/review/final evidence transaction. Native PowerShell, JXA and C# sources
  remain included; exception-file read and JSON parsing precede fallback time.
- `build-standalone.ts` owns generation and nonwriting comparison of both
  standalone outputs, with original YAML-first and identified semver notices.
- `official-inputs.ts` binds root declarations/lock, release evidence and isolated
  snapshot identity/integrity before builds and complete audits.
- `dist/` contains the committed dependency-free checker and original notices.
- `upstream-pnpm-lock.yaml` freezes the isolated official release dependency graph.
- `AGENTS.md` defines fail-closed implementation and test requirements.

The four pure policy owners use only their exact supplied-value dependencies;
none imports installed evidence, hashing or scans, including erased TYPE edges.
The gate and scan keep their independent complete transaction lifetimes.
Run `pnpm check:security` for the explicit network gate; the standalone entry's
`--phase lockfile --root .` runs repository-only pre-install checks and skips the
upstream scan and install.
`pnpm build:security` generates and `pnpm check:security:build` compares offline.
These modules are tooling, never installable Plugin runtime content.
