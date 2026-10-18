# Bundled Official Server Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the unchanged official chrome-devtools-mcp 1.10.1 release with the Plugin and remove runtime acquisition.

**Architecture:** One reviewed release manifest binds the frozen build dependency, committed isolated upstream lock and delivered files. Pure shared validation and adapter-owned file verification serve build, distribution and runtime. Each connection retains its independent official child.

**Tech Stack:** Node 24.21.0, pnpm 12.4.2, native erasable TypeScript, existing esbuild and official MCP SDK.

**Spec:** `docs/adr/0010-bundled-official-server.md`.

## Global Constraints

- Execute in the existing checkout on codex/bundle-official-server, as selected by the user.
- Keep 0.1.0 unreleased, official tools and routing unchanged, and no daemon or persisted session state.
- Preserve user caches, profiles, configuration and globally installed Skills.
- Default tests never download packages or start user targets; security checks stay an explicit network gate.
- Do not bypass installation trust, registry signatures, vulnerability checks or required verification.
- Complete a fresh independent review using gpt-6.1-sol before integration and push.
- The user authorizes local commits, ordinary push to origin/main, merged task-branch cleanup and CI waiting.

## Review Focus

- Windows path aliases, symlinked parents and alternate path spellings must not let files escape the verified package.
- A changed package after an earlier connection must fail verification before another child starts.
- A copied Plugin outside the repository must initialize without node_modules, npm/npx or user caches.
- Upstream published resource and notice bytes must survive copying and packaging unchanged.
- Frozen isolated scans and fingerprints must cover the same release identity as the build and invalidate changed resources.

## Task 1: Freeze the official release input

**Files:** root manifests/lock; tooling/official-server-release.json; tooling/security/upstream-pnpm-lock.yaml; tests/official-package.test.ts.

- [ ] Add a failing test proving the build dependency and committed evidence agree with shared version and official registry identity.
- [ ] Observe the focused failure before changing dependency configuration.
- [ ] Add the exact devDependency and resolve lock-only with scripts/hooks disabled and existing trust policy.
- [ ] Run the standalone pre-install security gate, then perform the frozen script-disabled install.
- [ ] Download a fresh canonical tarball into this plan's disposable workspace, verify its complete SHA-512, inspect/extract only safe regular entries and derive sorted SHA-256/byteLength evidence.
- [ ] Generate the isolated upstream snapshot with scripts/hooks disabled; bind its official resolution to the root lock and evidence.
- [ ] Run focused input tests and commit the reviewed inputs and plan.

## Task 2: Verify and deliver the original package

**Interfaces:** Shared OfficialReleaseEvidence and parseOfficialReleaseEvidence(input: unknown); adapter verifyOfficialPackage(directory, evidence) returns an exact relative-file Map<string, Buffer> after validation.

- [ ] Write failing fixture tests for malformed evidence, wrong identity, duplicate/escaping paths, symlinks, missing/extra/changed files and absent bin/license/resources.
- [ ] Implement pure validation in src/shared/official-package.ts and filesystem verification in src/adapters/official-package.ts.
- [ ] Extend Plugin generation with nested official-server paths and original notices; embed reviewed evidence into the gateway.
- [ ] Extend exact payload verification, byte-identical packaging and read-only build comparison; permit only declared obsolete output removal.
- [ ] Exempt only the verified immutable subtree from maintained formatting/README checks, keeping static JavaScript syntax checks.
- [ ] Run focused official-package/build/distribution/repository tests and commit the build boundary.

## Task 3: Launch only the delivered public Server

**Interfaces:** resolveServerBin(): Promise<string> replaces prepareServerBin; existing createOfficialConnection options remain compatible.

- [ ] Write failing tests for arbitrary-cwd resolution, missing/tampered package rejection before spawn, repeated verification and child-only update-check suppression.
- [ ] Resolve source and packaged paths relative to modules, using reviewed evidence embedded by the build for packaged execution.
- [ ] Keep shell-free hidden stdio children, Node executable, browser URL and existing DCT defaults.
- [ ] Remove acquisition code and scoped preload; set CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1 only in the official child's environment.
- [ ] Run focused runtime/bridge tests and commit the runtime change.

## Task 4: Bind isolated audits and document delivery

- [ ] Write failing tests for frozen committed snapshot validation, identity disagreement, review-before-install and changes to official resource fingerprints.
- [ ] Use the committed upstream lock with frozen lock-only validation and existing isolated scripts/hooks/store policy.
- [ ] Fingerprint release evidence, snapshot and all official payload bytes; keep accurate npm-graph audit scope for embedded vendors.
- [ ] Update policies, local rules, READMEs and changelog; mark ADR 0010 accepted.
- [ ] Rebuild Plugin and standalone security outputs; run focused tests, typecheck, verify:push and explicit check:security.
- [ ] Add/run a separate temporary-home, copied-Plugin catalog smoke without npm/npx or browser tools; normal stdin shutdown only.
- [ ] Commit generated output and documentation.

## Task 5: Review and deliver

- [ ] Produce a review package and dispatch one gpt-6.1-sol reviewer with the plan, spec, review focus, baseline and ledger rulings.
- [ ] Resolve material findings with observed regression RED-to-GREEN and a green suite; record any deferred minors or rulings.
- [ ] Verify final work and staged contents, integrate by fast-forward into main, and ordinarily push origin/main.
- [ ] Delete only the confirmed merged local task branch; preserve unrelated refs and work.
- [ ] Locate CI by the pushed full SHA and wait for all six required jobs to succeed, repairing genuine failures and revalidating new commits when needed.
- [ ] Report commit SHA, CI URL, verification, cleanup and material limitations; remove only this plan's checked scratch directory after recording its ledger decisions.
