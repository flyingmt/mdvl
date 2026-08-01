# Checksum and provenance mechanisms for mdvl

Research for [issue #12](https://github.com/flyingmt/mdvl/issues/12), captured
2026-08-01. This document evaluates mechanisms; it does not choose the npm
delivery architecture or the release transaction.

## Answer in brief

The Binary Installer can always enforce the required minimum without an OS
utility: download the selected release asset to a staging path, compute SHA-256
with Node's built-in `node:crypto`, compare it with an expected digest, and make
no installation change unless it matches. Node exposes streaming hash APIs, so
this does not add a runtime dependency beyond the Node/npm bootstrap already
implied by `npx` ([Node crypto](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)).

That comparison proves only that the downloaded bytes match the bytes named by
the expected digest. Its stronger meaning depends on where the expected digest
came from:

| Expected-digest source | What matching establishes | What it does not establish |
| --- | --- | --- |
| Digest hard-coded or packaged in the npm tarball | Native asset matches the mapping shipped by that npm package | Who legitimately produced the package unless npm authenticity/provenance is separately verified |
| `SHA256SUMS` beside a mutable GitHub release asset | Asset and manifest agree | Protection from an actor able to replace both |
| GitHub release-asset API `digest` | Asset matches GitHub's upload-time SHA-256 value | Build provenance or safety of the uploaded bytes |
| GitHub immutable-release attestation | Local asset matches a fixed tag, commit, and release asset recorded by GitHub | How the asset was built |
| GitHub Actions build-provenance attestation | Asset digest is bound to the verified workflow/repository identity and provenance fields | That source or build instructions are benign |

The useful no-code-signing stack is therefore layered, not substitutable:

1. SHA-256 is the mandatory pre-replacement byte gate.
2. A checksum manifest or GitHub asset digest publishes the expected value.
3. GitHub immutable releases prevent post-publication tag and asset mutation and
   add a release attestation.
4. GitHub artifact attestations can add workflow build provenance for each
   downloadable archive.
5. npm trusted publishing and npm provenance authenticate and describe the npm
   bootstrap package's publication; they do not automatically cover native
   assets fetched later from GitHub.

Attestations provide no benefit unless a consumer verifies them. GitHub says
this explicitly, and also warns that an attestation links an artifact to source
and build instructions rather than proving the artifact is safe
([GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)).

## Guarantee vocabulary

These properties must not be collapsed into a single "verified" state.

| Property | Question answered | mdvl example |
| --- | --- | --- |
| Integrity | Are these exactly the expected bytes? | Downloaded archive SHA-256 equals the selected manifest entry |
| Authenticity | Which expected identity made or endorsed the claim? | The attestation certificate identifies the expected GitHub repository and signer workflow |
| Provenance | Where, when, and how was the artifact produced? | SLSA statement names the source revision, builder, workflow, and invocation |
| Platform trust UI | Will the OS recognize a trusted publisher and avoid an unknown-developer warning? | Apple Developer ID/notarization or Windows Authenticode/Smart App Control |

SLSA defines provenance as verifiable information describing where, when, and
how an artifact was produced. Verification must check the envelope signature,
that the statement subject matches the artifact digest, the predicate type, the
builder identity, and expected source/build parameters
([SLSA provenance](https://slsa.dev/spec/v1.2/provenance),
[SLSA verification](https://slsa.dev/spec/v1.2/verifying-artifacts)). A digest
comparison alone is integrity, not provenance.

## Current mdvl release state

The current workflow builds on one runner per operating system and derives the
archive architecture from that runner's `RUNNER_ARCH`. It has no architecture
matrix, so one run can produce at most three runner-native archives rather than
the five targets required by map issue #9
([release.yml](../../.github/workflows/release.yml#L18-L69)).

The publish job downloads those archives and either creates a release or
uploads with `--clobber` when the tag already exists
([release.yml](../../.github/workflows/release.yml#L72-L106)). The workflow has
only `contents: write`; it does not generate a checksum manifest, generate an
artifact attestation, enable OIDC, verify the assets, or publish npm
([release.yml](../../.github/workflows/release.yml#L14-L15)).

`gh release list --repo flyingmt/mdvl` returned no releases on 2026-08-01, so
there is no existing mdvl release for an end-to-end digest or attestation check.

## GitHub mechanisms

### Release asset digests

GitHub automatically computes an immutable SHA-256 digest when a release asset
is uploaded. It exposes that digest in the Releases UI, REST API, GraphQL API,
and GitHub CLI
([GitHub release-asset digest announcement](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/)).
The REST schema represents `assets[].digest` as `string | null`, so a consumer
must reject a missing value rather than silently skip verification
([GitHub Releases REST API](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)).

The API digest avoids maintaining a second checksum file and is directly
consumable by JavaScript. Its trust anchor is the authenticated GitHub API
response and the repository/release identity requested by the installer. On a
mutable release, an authorized or compromised publisher can replace an asset
and thereby create a new asset record with a matching new digest. The digest
detects byte substitution after that upload; it is not an independent signature
by the build workflow.

### Portable `SHA256SUMS`

The conventional untagged checksum line is suitable for both human tools and a
small strict parser:

```text
<64 lowercase hexadecimal characters><space>*<filename>
```

The `*` mode marker selects binary input, appropriate for `.zip` and `.tar.gz`
assets and insensitive to host text-mode newline handling:

```text
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *mdvl-linux-x64.tar.gz
```

Perl `shasum` documents the digest, one mode character (`*` for binary or a
space for text), and filename format, and verifies it with
`shasum -a 256 -c SHA256SUMS`
([`shasum`](https://perldoc.perl.org/shasum)). GNU `sha256sum` computes and
checks SHA-2 digests in its untagged format
([GNU Coreutils](https://www.gnu.org/software/coreutils/manual/html_node/sha2-utilities.html)).
The same format is accepted by `actions/attest` through its
`subject-checksums` input
([`actions/attest`](https://github.com/actions/attest#identify-subjects-with-checksums-file)).

For mdvl's fixed asset names, a strict consumer parser should accept exactly one
64-hex SHA-256 binary-mode entry for the already-selected basename, reject
duplicate or malformed entries, and never treat a manifest filename as a
destination path.
Windows users can manually compute an individual SHA-256 with
`Get-FileHash`, whose default algorithm is SHA-256
([Microsoft `Get-FileHash`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash)).
The Binary Installer should use Node rather than shelling out, which makes the
same check available on all supported hosts.

A checksum file shipped beside assets is still controlled by the release
publisher. If both it and the asset are replaceable, it protects against
accidental corruption and isolated byte substitution, not compromise of the
publisher. Authenticating or freezing the manifest is what adds a stronger
property.

### Immutable releases and release attestations

With immutable releases enabled, publication locks the Git tag to its commit
and prevents release assets from being modified or deleted. Publication also
creates a cryptographically verifiable release attestation containing the tag,
commit SHA, and release assets
([GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)).
GitHub recommends creating a draft, attaching every asset, and then publishing
because publication makes the release immutable.

Consumers can run `gh release verify TAG` to verify the release attestation and
inspect the attested asset digests, or `gh release verify-asset TAG PATH` to
check that a local file exactly matches an attested release asset
([release verification](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity),
[`gh release verify-asset`](https://cli.github.com/manual/gh_release_verify-asset)).

This is a GitHub claim about a fixed release and its contents. It is not a SLSA
claim that a particular workflow built those contents. It also conflicts with
the current rerun strategy: `gh release upload --clobber` cannot update a
published immutable release. Draft construction, publication ordering, and
recovery therefore remain release-workflow decisions for issue #17.

### GitHub Actions artifact attestations

`actions/attest@v4` can create SLSA build provenance for a binary or archive.
For a binary subject, GitHub documents `id-token: write`, `contents: read`, and
`attestations: write`, followed by `subject-path` naming the artifact
([generating build provenance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)).
The action binds each subject name and digest to an in-toto predicate, obtains a
short-lived Sigstore signing certificate, and uploads the resulting Sigstore
bundle to GitHub
([`actions/attest`](https://github.com/actions/attest)). This is keyless: the
workflow receives an OIDC identity and does not store a long-lived signing key.

For public repositories, GitHub uses the Sigstore Public Good Instance, stores
a copy of the bundle, and writes it to a public immutable transparency log
([GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)).
Sigstore's trust root covers Fulcio certificates and Rekor log entries and is
distributed using TUF principles. Short-lived certificates bind an OIDC
identity to an ephemeral signing key
([Sigstore security model](https://docs.sigstore.dev/about/security/)).

`gh attestation verify ASSET --repo flyingmt/mdvl` verifies the subject digest,
signature, and repository identity. GitHub recommends narrowing policy further
with signer workflow, source ref, or source digest; merely finding any valid
attestation from an owner provides a weaker guarantee
([`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify)).
SLSA likewise requires the consumer to compare builder, source repository,
build type, and external parameters with preconfigured expectations
([SLSA verification](https://slsa.dev/spec/v1.2/verifying-artifacts)).

A Sigstore bundle carries the certificate, signature or DSSE envelope,
transparency-log evidence, and subject digest needed for verification, but the
verifier still needs a trusted root and expected signer identity
([Sigstore bundle format](https://docs.sigstore.dev/about/bundle/)). GitHub CLI
retrieves current trusted roots online; offline verification requires a
separately obtained `trusted_root.jsonl`, and GitHub warns that stale roots do
not reveal later key revocation
([GitHub offline verification](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline)).

Therefore an embedded JavaScript verifier cannot safely just decode the bundle
and compare its subject hash. It must validate the signature, certificate chain
and validity evidence, transparency-log evidence, OIDC issuer, expected
repository/workflow identity, predicate type, and subject digest. The official
Sigstore project supplies JavaScript signing/verification libraries, including
TUF support
([sigstore-js](https://github.com/sigstore/sigstore-js)), but including and
operating that verifier is a delivery-architecture decision for issue #18.

The attested subject should be the object the consumer downloads. Attesting
only `target/release/mdvl` does not authenticate a subsequently created
`.tar.gz` or `.zip`; attesting the archive (or a manifest whose entries the
consumer checks) closes that subject mismatch. Where in the multi-host workflow
those subjects are attested remains part of issue #17.

## npm mechanisms

### Tarball integrity and registry signatures

npm package metadata carries `dist.integrity`; registry signatures sign the
tuple `package-name@version:dist.integrity`. The npm registry publishes the
corresponding ECDSA P-256 verification keys
([npm registry signatures](https://docs.npmjs.com/about-registry-signatures/)).
`npm audit signatures` explicitly verifies downloaded packages' registry
signatures and errors on invalid or unexpectedly missing signatures
([verifying registry signatures](https://docs.npmjs.com/verifying-registry-signatures/)).

`npx` installs a remote package into an npm cache directory and then executes
its declared binary
([npm `npx`](https://docs.npmjs.com/cli/v12/commands/npx)). npm describes that
cache as content-addressable and says all data passing through it is integrity
checked on insertion and extraction
([npm cache](https://docs.npmjs.com/cli/v12/commands/npm-cache)). This protects
the bootstrap package tarball. It does not automatically extend
`dist.integrity` or the registry's signature to a GitHub archive that the
bootstrap downloads after it starts.

If a native-asset digest is shipped inside the npm tarball, npm tarball
integrity covers the bytes of that mapping. If the mapping is fetched from a
GitHub release, it instead inherits the GitHub mechanism's trust boundary.
Choosing between those patterns is issue #18.

### Trusted publishing and npm provenance

npm trusted publishing authorizes one configured CI workflow through OIDC and
uses short-lived workflow-specific credentials instead of a long-lived npm
publish token. GitHub Actions publishing requires `id-token: write`, npm CLI
11.5.1 or later, Node 22.14.0 or later, and a GitHub-hosted runner
([npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)). For a
public package published from a public GitHub or GitLab repository, trusted
publishing automatically creates provenance unless explicitly disabled.

npm provenance consists of a build provenance attestation and a registry
publish attestation. npm uses Sigstore's public-good service and transparency
ledger to link the package to source and build instructions; npm explicitly
states that this does not guarantee the package contains no malicious code
([npm provenance](https://docs.npmjs.com/generating-provenance-statements/)).
Consumers can inspect the source commit, build workflow, build environment, and
public-ledger entry on npmjs.com, or verify downloaded dependencies with
`npm audit signatures`.

The npm CLI documents `npm audit signatures` as an explicit operation after
dependencies have been installed; it verifies both registry signatures and
provenance attestations
([npm audit signatures](https://docs.npmjs.com/cli/v11/commands/npm-audit#audit-signatures)).
The primary documentation does not say that `npx` performs provenance
verification before executing a remotely fetched package. npm provenance must
therefore be treated as publication evidence and an explicit audit capability,
not as an automatic pre-execution gate for the bootstrap.

Most importantly, npm provenance's subject is the npm package. It does not
transitively prove the provenance of release assets fetched later. It can bind
an embedded digest mapping to the package's source and workflow when a consumer
actively verifies that package provenance, while a separate GitHub artifact
attestation can directly cover each native archive.

## What the Binary Installer can enforce before replacement

The following flow is independent of whether issue #18 selects bundled native
packages, a metadata package, or GitHub release downloads:

1. Resolve the requested exact version and supported platform to one expected
   artifact basename. Version-to-tag/package coupling is a decision for #18.
2. Obtain exactly one expected SHA-256 value from the selected trust anchor.
   Require the `sha256:` algorithm marker where the source supplies one and a
   64-hex digest; reject missing, duplicate, malformed, or wrong-name entries.
3. Download to a new staging path. Compute SHA-256 over the complete downloaded
   bytes with `node:crypto`; do not rely on filename, HTTP size, or successful
   extraction as an integrity signal.
4. Compare the computed digest to the expected digest. On mismatch or any
   verification error, delete staging data and leave the installed executable
   untouched.
5. If the chosen contract requires provenance, verify the attestation's trust
   root, signature and timestamp/log evidence, subject digest, OIDC issuer,
   `flyingmt/mdvl` repository, expected signer workflow, predicate type, and
   expected source ref/digest before extraction.
6. Only after verification, extract with a fixed expected archive layout. If
   publication supplies a separate digest for the extracted executable, verify
   that subject too before replacement.
7. Perform the existing-executable ownership check and replacement transaction.
   A valid checksum does not prove that the existing file is installer-owned;
   these are separate gates.

The minimum gate in steps 1-4 is implementable with Node built-ins and works on
all five targets. Steps 5-6 can produce stronger guarantees, but require a
chosen attestation distribution and verifier. `gh` is useful for maintainers
and manual verification, but the Binary Installer cannot assume GitHub CLI is
installed.

## Guarantee and consumer matrix

| Mechanism | Protected subject | Integrity | Authenticity / provenance | Can installer enforce before native replacement? | Trust root and principal limit |
| --- | --- | --- | --- | --- | --- |
| Node SHA-256 comparison | Downloaded archive or executable | Yes, against supplied digest | None by itself | Yes, with built-ins | Security is no stronger than expected-digest source |
| GitHub release asset `digest` | Uploaded release asset | Yes | GitHub API says these are the uploaded bytes; no build provenance | Yes | HTTPS, GitHub, requested repository/release; mutable publisher can replace asset record |
| Plain `SHA256SUMS` | Listed files | Yes | None by itself | Yes | Distribution location; asset and manifest may share one compromise boundary |
| Immutable-release attestation | Release tag, commit, assets | Yes | GitHub attests fixed release origin | Yes with a compatible verifier | GitHub release attestation trust; does not describe build process |
| `actions/attest` SLSA provenance | Named archive, binary, or manifest digest | Yes | Expected Actions repository/workflow plus provenance fields | Yes with `gh` or embedded Sigstore verifier | Sigstore/GitHub roots, OIDC issuer, expected repository/workflow/source policy |
| npm `dist.integrity` and cache | npm package tarball | Yes | None beyond registry metadata unless signature checked | npm enforces package-byte integrity before bootstrap runs | Configured npm registry and metadata |
| npm ECDSA registry signature | npm package name, version, tarball integrity | Yes | Registry endorses that tuple | Not documented as automatic for `npx`; explicit `npm audit signatures` exists | Registry signing-key endpoint; authenticates registry, not package build |
| npm provenance | npm package tarball and publication | Yes when verified | Source/build workflow and authorized publication | Not documented as automatic for `npx`; can be explicitly audited | Sigstore public-good roots/log plus expected source/workflow |
| Apple Developer ID/notarization | macOS executable/package | Yes | Apple-recognized developer and notarization result | OS enforces where applicable | Apple platform PKI; intentionally out of scope |
| Windows Authenticode/Smart App Control | Windows executable/package | Yes | CA-validated software publisher | OS enforces where applicable | Windows trusted CAs/reputation; intentionally out of scope |

## Platform trust remains separate

Apple says Gatekeeper checks for Developer ID on software distributed outside
the Mac App Store and uses notarization tickets to record Apple's security
checks. macOS warns for an app that is not registered with Apple by a known
developer and cannot use that registration to check whether it was modified
([Apple Developer ID](https://developer.apple.com/developer-id/),
[Apple unknown-developer warning](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)).

Microsoft says Authenticode identifies a software publisher through a
certificate chain to a trusted root and verifies code integrity. Smart App
Control permits appropriately RSA-signed applications from trusted certificate
providers
([Microsoft Authenticode](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/authenticode),
[Smart App Control signing](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)).

SHA-256 manifests, GitHub attestations, and npm provenance do not create either
platform signature. They therefore cannot promise the absence of Gatekeeper or
Smart App Control warnings. Exact behavior also depends on OS policy and how
download metadata is applied. OS code signing remains outside map issue #9's
scope; installer guidance must not describe checksum or provenance success as
OS publisher trust.

## Inputs left for the follow-up decisions

Issue #18, "Choose the npm-to-binary delivery architecture," still needs to
decide:

- Whether native archives are inside npm artifacts or fetched from GitHub.
- Where the authoritative version-to-asset SHA-256 mapping lives.
- Whether the runtime requirement stops at SHA-256 or embeds full GitHub/Sigstore
  attestation verification.
- How an npm package version maps unambiguously to a GitHub tag and exact native
  asset version.
- Whether verifier dependencies and trust-root updates fit the intended small
  bootstrap.

Issue #17, "Define release publication and recovery," still needs to decide:

- How all five target archives and the checksum manifest are produced and
  tested before visibility.
- Which consumed subjects are attested, in which build contexts, and which
  signer workflow/source expectations consumers enforce.
- Whether immutable releases are enabled and, if so, how draft upload,
  verification, and publication replace `--clobber` reruns.
- Whether npm uses trusted publishing directly or staged publishing, and the
  exact GitHub permissions and environment protections.
- The order that makes it impossible to observe an npm version whose required
  native artifact is absent or invalid, plus retry, deprecation, and recovery
  behavior after partial publication.

## Source gaps and validation needs

- npm documents explicit post-install `npm audit signatures`; it does not
  document automatic provenance verification before `npx` executes a package.
  Do not claim that guarantee without a version-specific executable test.
- GitHub documents release-attestation verification through `gh release verify`
  and `gh release verify-asset`, but the reviewed primary docs do not expose a
  stable, dedicated JavaScript API for embedding that exact release verifier.
  A prototype is needed before making it a runtime dependency.
- The GitHub release-asset REST digest is nullable. The implementation must be
  tested against a real uploaded asset and fail closed when absent.
- mdvl has no release as of the research date, so archive, manifest, release
  attestation, build attestation, and npm provenance have not been verified as
  one chain.
- OS warning behavior for a raw command-line binary varies with OS policy and
  download metadata. The sources establish that checksum/provenance is not OS
  code signing, not one universal warning transcript.
