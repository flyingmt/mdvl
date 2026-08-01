# Native compatibility baselines for mdvl releases

- Research date: 2026-08-01
- Ticket: [flyingmt/mdvl#23][I23]
- Decision context: [Wayfinder map #9][I9]

## Scope

The destination promises five OS/architecture tuples: macOS arm64, macOS x64,
Windows x64, Linux arm64, and Linux x64. It does not promise Windows arm64.[I9]
This report identifies viable native-binary contracts behind those labels. It
does not choose the final minimum OS, Windows ABI/CRT policy, Linux libc policy,
or archive count.

A Rust target triple is only one layer of such a contract. A releasable product
contract also needs a CPU baseline, minimum OS/kernel, libc or CRT linkage,
other dynamic-library requirements, and evidence that the finished executable
meets them. Rust Tier 1 means Rust CI builds and tests the target; Tier 2 means
Rust CI ensures it builds but does not necessarily run its tests. Neither tier
obligates third-party crates to support the target or certifies an mdvl release
artifact.[R1][R2]

## Findings

1. The current release job does not implement the five-tuple promise. It builds
   the host-default target once on each of `macos-latest`, `ubuntu-latest`, and
   `windows-latest`, and names archives from the runner-reported OS and
   architecture. It has no explicit Rust targets, deployment targets, libc/CRT
   controls, or artifact compatibility checks.[M1]
2. Rust's macOS floors are 11.0 for arm64 and 10.12 for x64, but Apple's current
   Xcode table lists macOS deployment targets starting at 11 for Xcode 26 and
   10.13 for Xcode 16. A Rust x64 target floor of 10.12 therefore is not, by
   itself, evidence that the current hosted Apple toolchain can produce and
   validate a 10.12-compatible mdvl binary.[R3][A2]
3. Windows x64 has two Rust Tier 1 candidates. MSVC is the native Microsoft ABI
   path and defaults to a dynamic C runtime while permitting static CRT
   selection. GNU is cross-compilable, but Rust says it has no maintainers; its
   target links MinGW support libraries and `msvcrt`.[R4][R5][R7][R8][R9]
4. The GNU Linux targets establish glibc 2.17 floors, with kernel 3.2 on x64 and
   4.1 on arm64. A dynamically linked GNU artifact covers glibc systems meeting
   its verified symbol floor, not native musl systems. The musl targets are
   Tier 2 with host tools, use musl 1.2.5, and default to static CRT linkage in
   current Rust target specifications.[R2][R6][R10][R11]
5. One unqualified Linux archive per architecture is only a viable candidate if
   a static-musl mdvl artifact is shown to have no external libc dependency and
   is tested across the intended kernel/distribution population. Otherwise the
   product must qualify Linux to one libc family or publish separate GNU and
   musl artifacts. musl documents that its fully static binaries can run without
   external dependencies on a matching instruction-set architecture and Linux
   syscall ABI.[L1]
6. The current mdvl graph is favorable to a static-musl experiment, but does
   not prove it. `ureq` is built with defaults disabled and only `json`; the
   lockfile has no Rustls, native-tls, OpenSSL, or ring package, and mdvl's
   production HTTP calls use numeric loopback URLs. `getrandom` uses OS entropy
   sources and falls back to `/dev/urandom` on supported older Linux kernels.
   Any future TLS/native dependency change must reopen this analysis.[M2][M3]
   [M4][M5][U1][GR1]

## Current release and dependency evidence

The workflow's three moving `-latest` labels compile with
`cargo build --release --locked` and no `--target`. Packaging reads
`RUNNER_OS`/`RUNNER_ARCH`, so a runner-label migration can change both the
binary and archive name without a workflow edit.[M1] GitHub announced that
`macos-latest` would migrate from macOS 15 to macOS 26 between June 15 and July
15, 2026, including a default-Xcode change from 16.4 to 26.4.1.[G3] No mdvl
GitHub Release existed on the research date, so no released Mach-O load
commands, PE imports, ELF dependencies, or symbol versions could be measured.[M6]

The resolved graph contains `ureq` 3.3.0 and `getrandom` 0.4.3.[M3] ureq 3.3.0
normally defaults to Rustls and gzip, but mdvl explicitly disables defaults;
its enabled `json` feature does not activate a TLS implementation.[M2][U1]
Production daemon requests use `http://127.0.0.1`, while the optional frontend
development proxy also uses loopback HTTP.[M4][M5] Thus the current executable
does not own a TLS provider or CA-root lookup contract. This is a graph-specific
fact, not a permanent property of mdvl.

## Rust target candidates

The floors below are Rust target floors, not selected mdvl product promises.

| Promised selector | Rust target candidate | Rust support | Documented Rust floor | Default libc/CRT shape |
| --- | --- | --- | --- | --- |
| macOS arm64 | `aarch64-apple-darwin` | Tier 1 with host tools | macOS 11.0+ | Apple SDK/system runtime |
| macOS x64 | `x86_64-apple-darwin` | Tier 2 with host tools | macOS 10.12+ | Apple SDK/system runtime |
| Windows x64 | `x86_64-pc-windows-msvc` | Tier 1 with host tools | Windows 10+ / Server 2016+ | Dynamic Microsoft CRT by default; static selectable |
| Windows x64 alternative | `x86_64-pc-windows-gnu` | Tier 1 with host tools, no maintainers | Windows 10+ / Server 2016+ | MinGW libraries plus imported `msvcrt` |
| Linux x64 | `x86_64-unknown-linux-gnu` | Tier 1 with host tools | kernel 3.2+, glibc 2.17+ | Dynamic glibc |
| Linux arm64 | `aarch64-unknown-linux-gnu` | Tier 1 with host tools | kernel 4.1+, glibc 2.17+ | Dynamic glibc |
| Linux x64 alternative | `x86_64-unknown-linux-musl` | Tier 2 with host tools | musl 1.2.5; kernel 3.2+ | Static musl by default |
| Linux arm64 alternative | `aarch64-unknown-linux-musl` | Tier 2 with host tools | musl 1.2.5; exact kernel floor not stated | Static musl by default |

The target and tier entries come from Rust's platform list and target pages.
The x64 musl kernel floor follows Rust's documented 1.64 baseline change; that
source says arm64 musl already had a higher kernel requirement but does not
state its exact floor.[R2][R3][R4][R5][R6][R12] Current Rust target source sets
`crt_static_default = true` for both relevant musl targets.[R10][R11]

Every distributable candidate should keep the target's default CPU baseline
unless a newer baseline is separately chosen and tested. `target-cpu=native`
generates for the build host's processor rather than the target's portable base
CPU, so a hosted release must not acquire it accidentally.[R13]

## Build-option matrix

All candidates require the explicit base command
`cargo build --release --locked --target <triple>`. `rustup target add` installs
the target standard library only; cross builds can still require the target
linker, SDK, C compiler, and native libraries.[R14]

| Candidate | Required explicit controls | Release evidence before claiming compatibility |
| --- | --- | --- |
| Both Apple targets | Pin runner image and Xcode/SDK; set `MACOSX_DEPLOYMENT_TARGET` separately for each architecture; retain target-default CPU | Record `rustc --print=deployment-target`; inspect final Mach-O architecture, minimum OS, and dylib imports; execute on the chosen oldest OS |
| Windows MSVC dynamic CRT | Build `x86_64-pc-windows-msvc` with default CRT mode and a pinned MSVC toolset | Inspect PE machine type and imports; document or deploy every non-system Visual C++ runtime dependency; execute on Windows 10 and Server floor if both are promised |
| Windows MSVC static CRT | Build the same target with `-C target-feature=+crt-static` consistently across the graph | Inspect PE imports to prove the selected CRT shape; execute on the selected Windows floor |
| Windows GNU | Provide `x86_64-w64-mingw32-gcc` or build natively with MinGW | Inspect PE machine type/imports and test without undeclared MinGW DLLs on the selected Windows floor |
| Linux GNU | Build against a controlled glibc-floor buildroot/sysroot, not merely the current runner root | Inspect ELF architecture, interpreter, `DT_NEEDED`, and highest required `GLIBC_*` versions; execute at the chosen glibc/kernel floor |
| Linux musl | Provide a musl linker/toolchain and preserve or explicitly request static CRT linkage | Prove no dynamic interpreter or undeclared `DT_NEEDED`; execute on representative glibc and musl distributions at the chosen kernel floor |

Rust exposes the effective Apple deployment target with
`rustc --print=deployment-target` and honors `MACOSX_DEPLOYMENT_TARGET`.[R3]
Apple defines the deployment target as the earliest OS on which software may
run and the base SDK as the newest API set available at build time; newer APIs
must be availability-checked when the deployment target is older.[A1] Rust's
CRT-selection documentation recommends inspecting the resulting binary rather
than assuming the requested linkage took effect.[R7] GNU `readelf` exposes ELF
dynamic entries and version sections for the Linux checks above.[L3]

## macOS implications

The arm64 Rust floor and Apple's current Xcode 26 range both begin at macOS 11.
The x64 situation has three materially different candidate claims:

| x64 claim candidate | Toolchain implication | Status of evidence |
| --- | --- | --- |
| macOS 10.12+ | Matches Rust's target floor | Apple's current Xcode support table does not list 10.12; a compatible SDK/linker path and oldest-OS test are not demonstrated by current hosted inputs |
| macOS 10.13+ | Above Rust's floor | Listed by Apple for Xcode 16; GitHub's explicit macOS 15 Intel image includes Xcode 16.4 |
| macOS 11+ | Above Rust's floor | Listed by Apple for Xcode 26; aligns both architectures on one OS-version number but remains a product decision |

Apple's table lists Xcode 16 deployment targets as macOS 10.13-15 and Xcode 26
targets as macOS 11-26.x.[A2] GitHub provides explicit Intel and arm64 macOS
runner labels and publishes each image's installed Xcodes/SDKs.[G1][G4][G5]
Consequently, setting only the Rust target is insufficient: the workflow must
pin the Apple toolchain, set the deployment target, and verify the final
Mach-O. One archive per macOS architecture is honest after those minimum-OS
contracts are fixed and tested; the archive name or installer diagnostics must
expose that minimum somewhere even though npm's selectors cannot.

## Windows implications

`x86_64-pc-windows-msvc` produces native PE/COFF using Microsoft's x64 calling
convention and supports Windows 10+/Server 2016+.[R4] Rust normally links C
runtimes dynamically, supports `+crt-static` for MSVC, and requires all native
code in a link to agree on CRT mode.[R7][W1]

With dynamic MSVC CRT linkage, the UCRT is an operating-system component on
Windows 10 and Server 2016, but other Visual C++ runtime libraries can require a
Redistributable at least as recent as the build toolset.[W2][W3] Static linking
can fold the Microsoft C++ library code into the application, avoiding separate
deployment of those library DLLs, but runtime fixes then require rebuilding and
redistributing mdvl.[W4] The final PE import table, not the Cargo command alone,
must decide which statement applies to a release.

The GNU target is viable as a separate candidate because Rust ships its standard
library and supports cross-compilation when the proper C toolchain is present.
It is not an equivalent proof shortcut: Rust explicitly reports no maintainers,
and current target source links a mix of MinGW support libraries, `libgcc`,
Windows system libraries, and `msvcrt`.[R5][R9]

One Windows x64 archive is honest if its product contract names the chosen ABI,
minimum Windows versions, and any CRT prerequisite, and artifact inspection plus
floor tests enforce that contract. Windows arm64 remains excluded by the map.[I9]

## Linux implications

### GNU/glibc artifacts

Rust's GNU floors are glibc 2.17 on both architectures, kernel 3.2 on x64, and
kernel 4.1 on arm64.[R2][R6] These are possible lower bounds, not an automatic
property of a binary linked on any newer distribution. Rust explains that
producing binaries for an old glibc needs an old build host or a buildroot with
that glibc.[R12] GitHub's current x64 and arm64 Ubuntu labels use Ubuntu 24.04,
whose `libc6` is glibc 2.39, so an unqualified host build does not demonstrate a
2.17 symbol ceiling.[G1][UB1]

A GNU release therefore needs a controlled buildroot and a gate over its actual
ELF interpreter, dynamic dependencies, and versioned symbols. A glibc-linked
artifact cannot be presented as covering native musl systems merely because
both report `linux` and the same CPU architecture.[R2][L1]

### musl artifacts

Rust distributes both musl target standard libraries and currently configures
both to link musl statically by default.[R2][R10][R11] musl states that a fully
static binary has no external dependencies even for DNS and character-set
conversion, and can run on a machine with the matching ISA and Linux syscall
ABI.[L1] This makes one static-musl artifact per architecture a technically
plausible broad-Linux candidate.

It remains unproved for mdvl. The release must show that the complete dependency
graph did not add a dynamic native library, establish a kernel floor, and run
the exact artifact on representative glibc and musl distributions. Rust's
current platform documentation does not state an exact arm64-musl kernel floor.
Static glibc should not be treated as an interchangeable shortcut: musl's own
deployment documentation contrasts its no-external-dependency DNS behavior
with glibc's dynamically loaded facilities, and glibc documents NSS as a
configurable subsystem.[L1][L2]

### TLS and CA roots

The present mdvl runtime makes loopback HTTP requests and compiles ureq without
a TLS feature.[M2][M4][M5][U1] Therefore TLS libraries and CA roots do not block
the current static-musl candidate. If installation, update checking, or another
future mdvl feature adds HTTPS inside the Rust binary, the selected ureq TLS
feature, crypto provider, root source, and native linkage become part of the
Linux contract and must be re-audited. The separate npx bootstrap's HTTPS
behavior is outside this executable-runtime finding.

## Native and cross-build feasibility

GitHub currently lists standard native runners for all five promised tuples:

| Tuple | Explicit standard runner examples |
| --- | --- |
| macOS arm64 | `macos-15`, `macos-26` |
| macOS x64 | `macos-15-intel`, `macos-26-intel` |
| Windows x64 | `windows-2022`, `windows-2025` |
| Linux x64 | `ubuntu-22.04`, `ubuntu-24.04` |
| Linux arm64 | `ubuntu-22.04-arm`, `ubuntu-24.04-arm` |

These labels and architectures are in GitHub's hosted-runner reference.[G1]
Native jobs are therefore feasible for all five tuples. Linux jobs can also run
inside a specified job container, which can freeze a glibc buildroot or provide
a musl environment independently of the host image.[G2]

Cross-building remains possible but does not remove platform contracts:

- Rust supports Apple cross-compilation with Clang, but linking can require an
  Apple SDK and explicit `SDKROOT`.[R3]
- MSVC supports architecture cross-builds from Windows when the Visual Studio
  components are installed; Rust does not support non-Windows-to-MSVC cross
  compilation.[R4]
- Windows GNU supports cross-compilation with the proper C toolchain.[R5]
- The arm64 GNU and musl Linux targets support cross-compilation. `rustup`
  supplies their Rust standard libraries, while builds containing native code
  can additionally require a target C compiler/linker.[R6][R14][R15]

The smallest credible release design can use explicit native runner labels for
Apple/Windows and either native architecture runners or controlled Linux
containers/toolchains. Whichever path is chosen must pin the target triple and
toolchain inputs rather than infer the product tuple from `RUNNER_ARCH`.

## Can five archives cover the promise?

| Candidate contract | Linux archives | Total archives | Honest coverage condition |
| --- | --- | --- | --- |
| GNU Linux only | GNU x64 + GNU arm64 | 5 | Promise says glibc, states verified glibc/kernel floors, and excludes native musl systems |
| GNU and musl separately | GNU x64/arm64 + musl x64/arm64 | 7 | Installer selects libc and every artifact has its own floor/linkage checks |
| Broad static-musl Linux | static-musl x64 + static-musl arm64 | 5 | Exact artifacts have no external libc dependency and pass the selected glibc/musl/kernel test matrix |

Thus five archives can be honest either by narrowing the Linux promise to
glibc or by proving broad static-musl artifacts. Five archives are not honest
for an unqualified Linux promise merely because npm sees only OS and CPU. Seven
archives are the direct expression of supporting both libc families with their
native Rust targets. This comparison selects none of the three.

macOS and Windows still need qualifiers even when their archive counts remain
one per architecture: minimum macOS version for each Apple artifact, and the
Windows ABI/CRT prerequisites for the x64 artifact.

## npm selector implications

npm platform packages can allow-list `os`, `cpu`, and, on Linux, `libc`; npm
defines those selectors from Node's platform/architecture and libc values.[N1]
The corresponding candidate metadata is:

| Payload | `os` | `cpu` | `libc` |
| --- | --- | --- | --- |
| macOS arm64 | `darwin` | `arm64` | omit |
| macOS x64 | `darwin` | `x64` | omit |
| Windows x64 | `win32` | `x64` | omit |
| Linux GNU arm64/x64 | `linux` | `arm64` / `x64` | `glibc` |
| Linux musl arm64/x64 | `linux` | `arm64` / `x64` | `musl` |
| Broad static-musl arm64/x64 | `linux` | `arm64` / `x64` | omit intentionally |

For a static-musl binary deliberately tested on both libc families,
`libc: ["musl"]` would wrongly filter it out on glibc systems; omitting `libc`
leaves the bootstrap responsible for enforcing the documented kernel/CPU
contract.[N1][L1] Conversely, separate dynamic GNU and musl packages should set
`libc` so npm does not choose an ABI-incompatible payload.

The npm fields cannot encode a macOS minimum version, Windows target ABI, CRT
mode, Windows minimum version, Linux kernel floor, or glibc symbol ceiling.[N1]
Those constraints must live in package naming, manifest data, bootstrap checks,
release documentation, or some combination. Node's `process.arch` describes the
architecture for which Node was compiled, so an x64 Node process under Rosetta
selects x64 rather than the physical arm64 CPU.[N2]

## Unknowns and exclusions

- The intended oldest macOS versions are not selected. In particular, no
  current hosted-toolchain path or test proves x64 macOS 10.12.
- The Windows MSVC/GNU choice and dynamic/static CRT policy are not selected.
  No mdvl PE artifact exists from which to inspect actual imports.
- The intended Linux distribution population is not selected. No static-musl
  mdvl artifact has been built and tested across glibc and musl systems.
- Rust's primary arm64-musl target page does not state an exact minimum Linux
  kernel version. That floor needs a source or empirical qualification before
  publication.
- No released artifact exists to inspect for Mach-O deployment commands,
  `GLIBC_*` versions, ELF `DT_NEEDED`, PE imports, or target CPU instructions.[M6]
- The current dependency result applies only to the lockfile and feature set at
  commit `1edcf02`. Native dependencies or TLS features added later can change
  every static/dynamic conclusion.[M2][M3]
- Windows arm64, Homebrew/WinGet/apt, system-wide installation, and paid OS code
  signing are outside the Wayfinder scope.[I9]

## Inputs for the later baseline decision

1. Choose a minimum macOS version per architecture, then require a pinned Xcode,
   explicit deployment target, Mach-O inspection, and oldest-OS execution.
2. Choose Windows MSVC or GNU and a CRT mode based on the desired native support
   contract and whether a Visual C++ prerequisite is acceptable.
3. Choose Linux coverage: glibc-qualified, dual GNU/musl, or tested broad
   static-musl. This determines whether the honest archive count is five or
   seven and whether npm `libc` metadata is present.
4. Define the release gate around finished artifacts, not build commands:
   architecture, minimum OS/kernel, dynamic imports, libc/CRT versions, and
   execution on every claimed floor.
5. Re-run dependency/linkage analysis whenever `Cargo.lock`, Cargo features, the
   Rust toolchain, Xcode/MSVC, or Linux buildroot changes.

No final native compatibility baseline is selected here.

## Sources

[I9]: https://github.com/flyingmt/mdvl/issues/9
[I23]: https://github.com/flyingmt/mdvl/issues/23
[M1]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/.github/workflows/release.yml#L18-L69
[M2]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/Cargo.toml#L14-L31
[M3]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/Cargo.lock
[M4]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/src/daemon.rs#L18-L21
[M5]: https://github.com/flyingmt/mdvl/blob/1edcf02c24c9ee2b1f56a3ebdea57e61148b8d89/src/server.rs#L27-L35
[M6]: https://github.com/flyingmt/mdvl/releases
[U1]: https://github.com/algesten/ureq/blob/b2adbf00f9a7ac0e2fbcb39d23c1b4f3da723e5c/Cargo.toml#L17-L83
[GR1]: https://docs.rs/getrandom/0.4.3/getrandom/#supported-targets
[R1]: https://doc.rust-lang.org/rustc/target-tier-policy.html
[R2]: https://doc.rust-lang.org/rustc/platform-support.html
[R3]: https://doc.rust-lang.org/rustc/platform-support/apple-darwin.html
[R4]: https://doc.rust-lang.org/rustc/platform-support/windows-msvc.html
[R5]: https://doc.rust-lang.org/rustc/platform-support/windows-gnu.html
[R6]: https://doc.rust-lang.org/rustc/platform-support/aarch64-unknown-linux-gnu.html
[R7]: https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes
[R8]: https://github.com/rust-lang/rust/blob/b6a3d7965e2c5de79378a88a3f28a6f1b73fbb16/compiler/rustc_target/src/spec/base/windows_msvc.rs
[R9]: https://github.com/rust-lang/rust/blob/b6a3d7965e2c5de79378a88a3f28a6f1b73fbb16/compiler/rustc_target/src/spec/base/windows_gnu.rs
[R10]: https://github.com/rust-lang/rust/blob/b6a3d7965e2c5de79378a88a3f28a6f1b73fbb16/compiler/rustc_target/src/spec/targets/x86_64_unknown_linux_musl.rs
[R11]: https://github.com/rust-lang/rust/blob/b6a3d7965e2c5de79378a88a3f28a6f1b73fbb16/compiler/rustc_target/src/spec/targets/aarch64_unknown_linux_musl.rs
[R12]: https://blog.rust-lang.org/2022/08/01/Increasing-glibc-kernel-requirements/
[R13]: https://doc.rust-lang.org/rustc/codegen-options/index.html#target-cpu
[R14]: https://rust-lang.github.io/rustup/cross-compilation.html
[R15]: https://doc.rust-lang.org/rustc/platform-support/aarch64-unknown-linux-musl.html
[A1]: https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/cross_development/Configuring/configuring.html
[A2]: https://developer.apple.com/support/xcode/
[W1]: https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library?view=msvc-170
[W2]: https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment?view=msvc-170
[W3]: https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170
[W4]: https://learn.microsoft.com/en-us/cpp/windows/deployment-in-visual-cpp?view=msvc-170
[L1]: https://musl.libc.org/about.html
[L2]: https://sourceware.org/glibc/manual/latest/html_node/Name-Service-Switch.html
[L3]: https://sourceware.org/binutils/docs/binutils/readelf.html
[G1]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
[G2]: https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container
[G3]: https://github.com/actions/runner-images/issues/14167
[G4]: https://github.com/actions/runner-images/blob/8d3ea005fa2d87f3cbc9255c27fdfed9e901a043/images/macos/macos-15-Readme.md
[G5]: https://github.com/actions/runner-images/blob/8d3ea005fa2d87f3cbc9255c27fdfed9e901a043/images/macos/macos-26-arm64-Readme.md
[UB1]: https://packages.ubuntu.com/noble/libc6
[N1]: https://docs.npmjs.com/cli/v12/configuring-npm/package-json/
[N2]: https://nodejs.org/docs/latest-v24.x/api/process.html#processarch
