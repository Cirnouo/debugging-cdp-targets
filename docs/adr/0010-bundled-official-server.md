# Official Server package delivered with the Plugin

Status: proposed design, 2026-10-02. The user selected build-time delivery of
the official package. This document specifies the implementation for review;
the current runtime still acquires it through npx.

## Intent and constraints

Deliver the reviewed `chrome-devtools-mcp@1.10.1` npm release with the Plugin,
so creating an official connection reads the delivered files and starts its
public Server bin. The same reviewed artifact must be used by the build,
distribution verification, and runtime. Version 0.1.0 remains unreleased.

An **Official Server package** is the immutable upstream release artifact.
An **Official Server** remains the unmodified upstream child process owned by
one connection. All connections share package files, and each connection keeps
its independent Server process, SDK transport, router and target identity.

The gateway continues forwarding official tools and results through the
official SDK. Its routing, lifecycle, Hooks, Close/Keep behavior and target
verification retain their existing contracts. All maintained implementation
code remains native, erasable TypeScript. Node 24.21.0 and pnpm 12.4.2 remain
the contributor toolchain.

## Current behavior and selected trade-off

`prepareServerBin()` currently invokes npx for every new upstream connection,
checks the reported version, computes the expected `_npx` cache directory,
and validates its package metadata before returning the public bin. The
gateway also creates a temporary upstream to discover the tool catalog at
startup. Consequently, even catalog discovery passes through acquisition.

The supply-chain gate currently resolves a separate disposable upstream
lockfile. Its policy correctly states that this graph cannot guarantee what
a later runtime download will contain.

The selected design moves acquisition to contributor dependency preparation
and delivers the official release as a separate directory. It avoids the
runtime npm/cache dependency and binds the distributed bytes to reviewed
inputs. It increases the committed Plugin size and requires a Plugin rebuild
when the official version changes. A first-use download cache would preserve
a smaller payload but add download, extraction, concurrent preparation and
recovery behavior to runtime; that trade-off was not selected.

Registry metadata inspected on 2026-10-02 identifies 359 release files and
14,250,471 unpacked bytes, approximately 13.6 MiB. This is an unpacked size,
not a measured Plugin transfer size. The release has no regular runtime
`dependencies` and declares two optional peers, `@toon-format/toon` and
`@blackwell-systems/gcf`. Those peers are absent from the current runtime
installation and will remain absent from this release's delivered package.

## Reviewed inputs

Add the exact official package as a root build-only `devDependency`, covered
by `pnpm-lock.yaml` and the existing installation trust policy. The Plugin
consumer does not install repository dependencies. The declared version,
shared `PACKAGE_VERSION`, lock entry and reviewed release evidence must agree.

Add `tooling/official-server-release.json` as maintained release evidence. It
records the package name/version, public bin, canonical registry tarball URL,
complete SHA-512 tarball integrity, and a sorted list of every release-relative
file with its SHA-256 and byte length. The initial evidence is derived from a
fresh canonical registry tarball after verifying its complete SHA-512 value;
the user's runtime cache is not an evidence source. Paths must be relative,
unique and confined to the package. Symlinks and other non-regular entries
are rejected. Builds consume this reviewed evidence and never regenerate it.

For 1.10.1 the inspected registry identity is:

```text
https://registry.npmjs.org/chrome-devtools-mcp/-/chrome-devtools-mcp-1.10.1.tgz
sha512-Klw6HWDqHC/XS1JwZldd2r49aUhbUJN9m9Mvcx4SEueIPXtzuQX+QelxAViobv8YUkDZ7HWDrmViR6LeYK0wAw==
```

This metadata identifies the intended input; implementation must still verify
the downloaded tarball bytes before deriving its file evidence. Evidence
updates are explicit dependency reviews, not repairs performed automatically
after a build or installation failure.

Add `tooling/security/upstream-pnpm-lock.yaml`, a committed standalone lock
snapshot for the exact official package with its optional peers absent. The
isolated scan generates its private manifest from shared constants and copies
this snapshot instead of resolving a new graph. Its official resolution and
integrity must match the root lock and release evidence. A future release
introducing required external runtime dependencies requires a new packaging
design; this design fails closed instead of silently omitting them.

## Build and payload

`pnpm build:plugin` reads the package installed by the frozen contributor
installation, verifies its metadata and complete file tree against the
reviewed evidence, and copies it byte-for-byte into:

```text
plugins/debugging-cdp-targets/dist/official-server/
```

This directory is the original package root, including `package.json`, the
public bin, runtime assets, published skills, LICENSE, bundled package index
and third-party notices. The build does not compile, rewrite, tree-shake or
merge official code into the gateway. Existing gateway bundles continue using
esbuild. All published files are retained to preserve relative resource paths
and the original release identity.

The generated-file map uses complete relative paths so nested release files
cannot collide by basename. Build writes are confined to the owned output
directory. A changed file inventory is rejected before writes; removal of any
obsolete generated output is confined to paths declared by reviewed build
evidence, with resolved-path checks before recursive operations.

`pnpm check:build` performs the same verification and compares expected bytes
and complete output inventory without writing, networking, installing, or
executing the Server. It rejects missing, extra and changed official files.

The payload policy retains its exact local-file inventory and adds an exact
official-file inventory derived from repository-owned release evidence.
Distribution validation verifies the digests as well as paths and performs
byte-identical packaging of the expanded payload. A manifest inside the copied
package is not its own authority for which files may ship.

Repository checks treat this precisely delimited, verified directory as
immutable third-party distribution output. It is exempt from maintained-source
formatting and per-directory README requirements. The exemption does not
apply to another directory or permit handwritten JavaScript. All executable
JavaScript in the official subtree remains eligible for static syntax checks.
Its original notices are preserved and referenced by the Plugin notices.

## Runtime resolution and launch

Replace acquisition with a read-only resolver in `official-server.ts`.
Packaged execution resolves the official directory relative to the gateway's
module URL. Native TypeScript execution resolves the same committed Plugin
directory relative to the source module. Neither path depends on the caller's
working directory or npm cache layout.

The build embeds the reviewed version, bin and file digests in the gateway.
Before spawning an official child, the resolver validates the delivered package
metadata and regular-file contents against that independent expected evidence,
rejects internal symlinks or path escapes, and returns the verified public bin.
The child still runs through `process.execPath`, with `shell:false`, hidden
helper windows, and the existing stdio/SDK connection. Official arguments retain
the existing loopback browser URL and `DCT_*` option validation.

The official package's own update checker can otherwise start a detached
registry-check subprocess. Set `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1` only
in each official child's environment, using the upstream-supported switch.
Dependency versions are updated through Plugin development. This allows
dependency startup to avoid an update lookup while preserving tool behavior;
tools that need network access continue to need it.

Remove the acquisition-only npx launcher, cache/hash code, Windows preload,
private preload build define, and generated `hide-npm-console.cjs`. Runtime
failures identify a missing, changed or incompatible delivered package and
direct the user to reinstall or rebuild the Plugin. They do not download a
replacement or fall back to a runtime cache or global installation.

Existing npm caches, Chrome profiles, upstream update caches, user configuration
and globally installed Skills are not modified or deleted. Runtime package
resolution does not create persistent session state. A missing package fails
gateway catalog initialization; a package failure during connection creation
uses the controller's existing rollback and cleanup behavior.

## Supply-chain checks

Root lockfile preflight covers the new build dependency before ordinary
installation. The complete isolated upstream scan uses the committed snapshot
with the existing isolated configuration/store, disabled scripts and hooks,
and strict installation trust. It performs frozen lock-only validation, audits
and signature verification, evaluates findings, and only then permits a frozen
installation and installed-graph verification. It never executes the Server.
Both dependency preparation and build checks reject disagreement with the
reviewed official artifact. Default tests and `verify:push` remain offline.

Include the new release evidence, upstream snapshot and official payload files
in appropriate supply-chain fingerprints. Changed upstream executable bytes
or resources must invalidate a matching review exception. Existing exception
expiry, signature checks, audit completeness and installation policy remain
enforced; the implementation does not add trust or vulnerability exceptions.

The npm release embeds libraries that are absent from its npm dependency graph.
Preserve and bind `build/src/third_party/bundled-packages.json` and
`THIRD_PARTY_NOTICES` to the reviewed complete release. Report the npm-graph
audit scope accurately: it is not an independent vulnerability scan of every
library embedded in those bundles. This change improves artifact consistency
without claiming a new embedded-code analyzer or deriving unsupported coverage
from the upstream index alone.

## Verification and implementation scope

Add adversarial fixture tests before changing validators or runtime behavior:

- Wrong version, registry/integrity disagreement, malformed evidence, duplicate
  or escaping paths, symlinks, missing/extra files, changed bytes and public-bin
  escapes fail closed.
- Build and read-only comparison cover nested resources, original notices and
  full inventories. No validator accepts the copied payload as its own proof.
- Runtime fixtures cover module-relative lookup from an arbitrary working
  directory, missing/tampered packages, child arguments and scoped update-check
  suppression. They verify failure happens before an official child is spawned.
- Supply-chain fixtures cover committed snapshot agreement, frozen validation,
  review-before-install and changed package fingerprints with injected process
  execution. They never download or run the real Server.
- A separate opt-in packaged-plugin MCP smoke test initializes the real delivered
  public bin and reads its catalog without starting a browser. npm/npx access
  and update checks are unavailable in that fixture. It uses a temporary home
  and closes the catalog child through stdin. It is outside the default test
  suite and supply-chain scanner. This proves dependency startup,
  not offline operation of every tool or a successful user installation.

Run focused tests, `pnpm typecheck`, `pnpm build:plugin`, the regenerated
standalone security build if its source changes, and `pnpm verify:push`.
Run the explicit network `pnpm check:security` for dependency/build changes.
Windows, Linux and macOS validation continues through the existing CI matrix.
No verification requires taking over a user target or altering an old cache.

Implementation touches dependency manifests/locks, release evidence, the
official resolver and bridge, Plugin build/payload validators, supply-chain
tooling, focused tests, generated distribution, and relevant documentation.
Update the root and Plugin READMEs, local contributor rules and Unreleased
changelog when the behavior is implemented. After design approval, write the
implementation plan for review before implementation begins.
