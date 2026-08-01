# Native-binary delivery patterns in npm

- Research date: 2026-08-01
- Ticket: [flyingmt/mdvl#10][I10]
- Decision owner: later ticket "Choose the npm-to-binary delivery architecture"

## Scope

This report compares payload delivery for the user-wide **Binary Installer**. It
does not change or describe the Project Root-scoped Skill Installer invoked by
`mdvl install`. Node/npm is bootstrap-only: after a successful operation, the
PATH entry must execute the standalone Rust `mdvl` binary, not an npm or Node
shim. These boundaries come from the Wayfinder map.[I9]

The three delivery patterns are compared without selecting one:

1. A thin npm package that downloads one exact GitHub Release artifact.
2. A thin root package with exact-version, per-platform npm packages in
   `optionalDependencies`, filtered by `os`, `cpu`, and, if needed, `libc`.
3. One npm package containing every supported artifact.

Payload location and execution timing are separate decisions. Any pattern can
put install/update/uninstall logic in the package's executed `bin`; a GitHub
download does not inherently require an npm install script.

## Verified facts

### Current mdvl release inputs

- The current workflow runs `cargo build --release --locked` on three runner
  labels (`macos-latest`, `ubuntu-latest`, `windows-latest`), derives archive
  names from `RUNNER_OS` and `RUNNER_ARCH`, emits `.tar.gz` except for a Windows
  `.zip`, and creates or updates a GitHub Release.[M1]
- It does not pass an explicit Rust target, enumerate all five required
  OS/architecture tuples, or generate a SHA-256 manifest. On an existing
  release it uploads with `--clobber`, so the workflow itself permits asset
  replacement when GitHub release immutability is not enforcing a lock.[M1]
- The README describes GitHub Releases as raw binary archives.[M2] No published
  release was available to measure on the research date.[M3]

### npx and npm contracts

- Current npm 12 implements `npx` through `npm exec`. A missing package is
  installed into an npm-cache folder placed on the child process `PATH`; npm
  prompts before doing so. A single `bin` entry is enough for npx to infer the
  executable.[N1]
- `npx @flyingmt/mdvl@X` can request an exact package version. Without a
  specifier, however, npx may use the version already present in the current
  project's dependencies. Thus bare `npx @flyingmt/mdvl` is not an unconditional
  guarantee of the registry's latest version.[N1] For registry resolution with
  no local match, npm's default `latest` dist-tag identifies the version used
  when no version or tag is supplied.[N7]
- `npx --offline ...` fails when required npm package data is not cached. npm
  states that its cache is not a persistent or reliable data store, although
  returned cache data is integrity-checked.[N2][N5]
- npm supports package allow-lists through `os`, `cpu`, and Linux `libc`; the
  first two use Node's platform and architecture values. Optional dependency
  install failures do not fail the parent install, `--omit=optional` suppresses
  them, and the consuming program must handle their absence.[N3]
- `process.arch` is the architecture for which the running Node binary was
  compiled, not necessarily the physical machine architecture. Relevant Node
  values are `darwin`, `win32`, and `linux`, with `arm64` and `x64` CPU
  values.[N9][N10]
- npm 12's npx/npm-exec install-script policy only allows approved package
  identities; unreviewed scripts are blocked with a warning by default and can
  become a hard error under `strict-allow-scripts`. `--ignore-scripts` also
  suppresses package scripts.[N2] npm has no uninstall lifecycle script from
  npm 7 onward.[N4]
- npm publication records SHA-512 tarball integrity and later installs verify
  the strongest supported integrity algorithm. That protects the npm tarball;
  it is not the requested SHA-256 verification of an mdvl release artifact.[N6]
- An npm `name@version` cannot be republished, even after unpublish.[N6] A public
  scoped package can be explicitly published with `npm publish --access public`.[N8]
- GitHub Release asset downloads may return either a body or a redirect, and
  the asset API exposes 404 as a normal missing-asset response.[G1] An
  unauthenticated REST API client has a 60-request-per-hour primary limit, so a
  downloader that calls the API owns this additional failure mode.[G3]
- GitHub immutable releases lock both the tag and assets after publication;
  mutable releases do not provide that guarantee.[G2]

### Maintained package patterns

- `tree-sitter-cli` is a thin GitHub Release downloader. Its npm `install`
  script maps Node platform/architecture to an asset, constructs the release
  tag from its own package version, follows redirects, decompresses the asset,
  and sets executable permissions.[T1][T2] That implementation does not perform
  a checksum comparison.[T2]
- esbuild publishes a root package with exact-version optional dependencies for
  platform packages, and each platform package declares `os` and `cpu`.[E1][E2]
  The root package contains SHA-256 hashes; its installer verifies a selected or
  fallback-downloaded binary and checks the binary-reported version.[E1][E3]
- dprint generates exact-version optional packages with `os`, `cpu`, and
  glibc/musl `libc` metadata, records SHA-256 values in the root package, and
  publishes platform packages before the root package.[D1] Its `bin` repeats
  installation lazily if `postinstall` did not create the executable, and its
  registry fallback verifies the executable SHA-256 before writing it.[D2][D3]
- Biome also publishes separate glibc and musl packages for Linux x64/arm64,
  showing that OS and CPU alone are insufficient when both Linux libc families
  are supported.[B1][B2]

## Comparative implications

Let `J` be the compressed JS bootstrap size, `B_t` the compressed binary for
the selected target, and `sum(B)` all supported compressed binaries. These are
relative payloads, not measurements; mdvl currently has no published artifacts
from which to calculate them.[M3]

| Concern | Thin GitHub Release downloader | Per-platform npm packages | All artifacts in one npm package |
| --- | --- | --- | --- |
| npm payload | About `J`; the separate GitHub transfer is `B_t` plus checksum data.[T1][T2] | Root `J` plus one compatible `B_t`; candidate package metadata may also be resolved. esbuild and dprint use this shape.[E1][D1] | `J + sum(B)` on every npm cache miss because all included files share one tarball; npm's `files` field controls that tarball.[N3] |
| Network ownership | npm registry first, then GitHub. The downloader owns redirects, proxy/CA behavior, timeouts, and optionally GitHub API rate limits.[G1][G3][T2] | npm registry for root and selected payload. npm owns registry transport; fallback HTTP code, if added, becomes application-owned.[E3][D3] | One npm-registry package transfer. No second artifact origin. |
| Offline reinstall | Cached npm bootstrap alone is insufficient unless the downloader also owns a durable artifact cache. npm `--offline` does not cache an arbitrary GitHub fetch.[N2][N5] | Can work while required root/child package data remains cached, but npm explicitly gives no persistence guarantee.[N2][N5] | Same cache caveat, but one cached tarball contains every target payload.[N5] |
| Exact-version coupling | Wrapper `X` can point to release tag `X` and embed or fetch hashes for `X`, as tree-sitter couples its package version to the release URL.[T2] Release assets/checksums must exist before publishing wrapper `X`. | Root `X` should pin child `X` exactly, as esbuild/dprint do.[E1][D1] At least five child versions plus the root must be published; a glibc/musl split raises that to seven children plus root. | One immutable npm `name@X` contains all `X` payloads, so there is no cross-package version skew. |
| SHA-256 placement | Hashes can be embedded in wrapper `X` or obtained from an exact release checksum asset. If binary and checksum are both mutable release assets, replacing both defeats historical coupling unless another immutable anchor is used.[G2][M1] | Root `X` can contain hashes for every child binary and verify before copying; dprint and esbuild demonstrate this.[D1][D3][E3] | A manifest in the same tarball can verify the selected extracted binary. npm's SHA-512 tarball check remains separate from the required release SHA-256.[N6] |
| Install scripts | If download occurs in `install`/`postinstall`, current npm 12 may block it before the package `bin` runs; tree-sitter depends on this timing.[N2][T1] Bin-time download avoids that policy but still owns network errors. | Payload selection itself needs no script. A script may copy/optimize, but dprint's bin-time fallback illustrates recovery when postinstall did not run.[D2][D3] | Selection and copy can occur entirely in the executed `bin`; no install script is necessary. |
| Platform selection | JS maps Node platform/arch to an exact asset name and must reject every unsupported tuple before mutation.[N9][T2] | npm filters child packages using metadata; the executed bin must still detect a missing optional package and verify the tuple/hash.[N3][E2] | JS selects one embedded path and must reject unsupported tuples; npm cannot validate each embedded file independently. |
| Registry/release transaction | One public npm identity plus one GitHub release transaction. GitHub availability and mutability remain runtime concerns.[G2] | One public root identity and at least five public child identities per version. Optional semantics can let a partially published set install the root successfully but fail only when executed.[N3][N6] | One public identity and one immutable package publication. A missing or wrong artifact invalidates that version for all targets and requires a new version.[N6] |
| Characteristic failures | GitHub blocked/outage, proxy/TLS/redirect bug, asset/checksum 404, checksum mismatch, mutable asset drift, unsupported selector. | Child omitted, missing, or wrong exact version; `--omit=optional`; partial publish; wrong `os`/`cpu`/`libc`; checksum mismatch; registry mirror lacks child. | Large transfer/unpack, selector points at wrong file, one target omitted, checksum mismatch, or one bad target forcing a whole-package replacement version. |

For every pattern, once the verified executable has been copied into the
installer-owned user location, normal `mdvl` execution is offline and
Node-independent. The table's network and cache differences apply to install,
update, downgrade, or repair, not to the installed Rust binary's runtime.

## Target-specific failure surface

| Required target | Selector | Meaningful failures to make explicit |
| --- | --- | --- |
| macOS arm64 | `darwin` + Node `arm64` | An x64 Node process running under Rosetta reports/selects x64 rather than physical arm64; esbuild treats this as a common cross-architecture package mismatch.[N9][E4] Missing arm64 payload, checksum mismatch, or lost executable mode must stop before replacement.[T2] |
| macOS x64 | `darwin` + Node `x64` | The release workflow names this OS `macos`, so a GitHub selector needs an explicit `darwin` to `macos` mapping.[M1] A package tree created under arm64 Node and reused under x64 Node can contain the wrong child.[E4] |
| Windows x64 | `win32` + Node `x64` | On an x64 Windows runner, the workflow produces `mdvl-windows-x64.zip` containing `mdvl.exe`.[M1] Native arm64 Node is outside the required tuple and must not silently receive x64; missing child/asset, ZIP failure, checksum mismatch, or an occupied destination are distinct failures. |
| Linux arm64 | `linux` + Node `arm64` + unresolved libc | The current workflow has no explicit arm64 target.[M1] If only `os`/`cpu` is used, glibc and musl are indistinguishable; maintained packages add `libc` packages or perform runtime detection.[D1][B1][B2] |
| Linux x64 | `linux` + Node `x64` + unresolved libc | The current workflow creates a Linux host archive but does not state a Rust target triple or minimum libc.[M1] A selected binary can therefore match OS/CPU metadata yet fail at process start on an unsupported libc or baseline. |

## Lifecycle implication

An npm package lifecycle is not the Binary Installer lifecycle. npx first
materializes the package and then invokes its `bin`; install scripts can be
blocked, and npm provides no uninstall hook.[N1][N2][N4] Consequently, all
three payload patterns can expose explicit Binary Installer install/update/
uninstall operations from the executed bootstrap, which can own state,
verification, and rollback. This does not decide where the payload is hosted.
It also leaves the existing `mdvl install` command as the distinct Project
Root-scoped Skill Installer.[I9]

## Unknowns for the architecture decision

- Package identity availability and ownership for `@flyingmt/mdvl`, plus any
  child names, were not verified in this ticket.[I9]
- The supported Node/npm version floor is unspecified. npm 12's default
  install-script approval behavior makes this material to any postinstall-only
  design.[N2]
- Bare `npx @flyingmt/mdvl` can select a project-local version. The later spec
  must reconcile that with "latest stable" or require an explicit tag.[N1][N7]
- Linux glibc versus musl support, minimum libc, and minimum macOS version are
  not defined. `linux arm64/x64` alone is not an executable compatibility
  contract.[B1][B2]
- The exact-version UX is undecided: package version equals requested mdvl
  version, or a latest bootstrap accepts a separate target version. This changes
  where historical checksums live.
- "Verify release SHA-256" does not yet say whether the digest covers the
  compressed archive, extracted executable, or both, nor where its immutable
  trust anchor lives. The current workflow emits neither.[M1]
- GitHub release immutability is not publicly confirmed for this repository,
  and there was no release from which to measure actual compressed payloads.[G2][M3]
- No official npm documentation stating a public-registry tarball size ceiling,
  and no current first-party package intentionally bundling all five native
  targets in one tarball, was found. The all-artifacts size comparison therefore
  follows npm's documented tarball inclusion and integrity behavior, not a
  representative package measurement.[N3][N6]

No final delivery architecture is selected here.

## Sources

[I9]: https://github.com/flyingmt/mdvl/issues/9
[I10]: https://github.com/flyingmt/mdvl/issues/10
[M1]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/.github/workflows/release.yml
[M2]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/README.md#L24-L35
[M3]: https://github.com/flyingmt/mdvl/releases
[N1]: https://docs.npmjs.com/cli/v12/commands/npx/
[N2]: https://docs.npmjs.com/cli/v12/commands/npm-exec/
[N3]: https://docs.npmjs.com/cli/v12/configuring-npm/package-json/
[N4]: https://docs.npmjs.com/cli/v12/using-npm/scripts/
[N5]: https://docs.npmjs.com/cli/v12/commands/npm-cache/
[N6]: https://docs.npmjs.com/cli/v12/commands/npm-publish/
[N7]: https://docs.npmjs.com/cli/v12/commands/npm-dist-tag/
[N8]: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
[N9]: https://nodejs.org/docs/latest-v24.x/api/process.html#processarch
[N10]: https://nodejs.org/docs/latest-v24.x/api/process.html#processplatform
[G1]: https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28#get-a-release-asset
[G2]: https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
[G3]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#primary-rate-limit-for-unauthenticated-users
[T1]: https://github.com/tree-sitter/tree-sitter/blob/963b5a5a971021359cf091a63d4f1286bc319643/crates/cli/npm/package.json
[T2]: https://github.com/tree-sitter/tree-sitter/blob/963b5a5a971021359cf091a63d4f1286bc319643/crates/cli/npm/install.js
[E1]: https://github.com/evanw/esbuild/blob/6ff1d8b0d8c134e867a397eef39702a223ebef9e/npm/esbuild/package.json
[E2]: https://github.com/evanw/esbuild/blob/6ff1d8b0d8c134e867a397eef39702a223ebef9e/npm/%40esbuild/darwin-arm64/package.json
[E3]: https://github.com/evanw/esbuild/blob/6ff1d8b0d8c134e867a397eef39702a223ebef9e/lib/npm/node-install.ts
[E4]: https://github.com/evanw/esbuild/blob/6ff1d8b0d8c134e867a397eef39702a223ebef9e/lib/npm/node-platform.ts
[D1]: https://github.com/dprint/dprint/blob/9de83ef27dd693b783637bbbad700e01765394b6/deployment/npm/build.ts
[D2]: https://github.com/dprint/dprint/blob/9de83ef27dd693b783637bbbad700e01765394b6/deployment/npm/bin.cjs
[D3]: https://github.com/dprint/dprint/blob/9de83ef27dd693b783637bbbad700e01765394b6/deployment/npm/install_api.cjs
[B1]: https://github.com/biomejs/biome/blob/4c2029863f4f41d88acb2aa6ca07b3fedc329533/packages/%40biomejs/biome/package.json
[B2]: https://github.com/biomejs/biome/blob/4c2029863f4f41d88acb2aa6ca07b3fedc329533/packages/%40biomejs/cli-linux-x64-musl/package.json
