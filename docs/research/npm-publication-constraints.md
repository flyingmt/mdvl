# npm Publication Constraints for `@flyingmt/mdvl`

Research date: 2026-08-01

## Question and Boundary

This report asks what anonymous npm registry data and primary npm and Node.js
documentation establish about publishing and invoking `@flyingmt/mdvl` through
`npx`.

The investigation used only public, unauthenticated sources. It did not run
`npm login`, inspect credentials or tokens, publish a package, or mutate an npm
account. Consequently, it can establish public registry state and platform
rules, but not ownership or publish access.

This is constraint research, not the final package manifest or release
procedure. In particular, Node.js and npm are only the bootstrap environment;
the installed mdvl binary remains runtime-independent.

## Findings

### Public Registry State

On the research date, the anonymous public registry request
[`GET /@flyingmt%2Fmdvl`](https://registry.npmjs.org/%40flyingmt%2Fmdvl)
returned HTTP 404 with `{"error":"Not found"}`. As a control, the same registry
returned HTTP 200 for the public package
[`@npmcli/arborist`](https://registry.npmjs.org/%40npmcli%2Farborist).

This establishes only that the public registry exposed no package document for
`@flyingmt/mdvl` to an anonymous client at that time. Therefore, an
unauthenticated `npx @flyingmt/mdvl` using the default public registry could not
resolve the package then.

The 404 does **not** establish that the package name is claimable, that no
private package exists, that the `@flyingmt` scope exists, or that the current
maintainer controls it. npm documents that a scope belongs to either a user or
an organization and that scoped packages can be public or private
([About scopes](https://docs.npmjs.com/about-scopes)). Private package data and
scope permissions are not anonymously visible.

### Scope and Public-Package Requirements

`@flyingmt/mdvl` is a scoped package name. npm ties a user scope to the matching
npm username and an organization scope to the matching organization. Publishing
under that scope requires an authenticated account with permission in that
scope; anonymous registry state cannot prove this permission
([About scopes](https://docs.npmjs.com/about-scopes),
[Organization roles and permissions](https://docs.npmjs.com/organization-roles-and-permissions)).

Official npm documentation is currently inconsistent about the default access
of a newly published scoped package:

- The task guide says scoped packages are private by default and instructs
  public publishers to use `npm publish --access public`
  ([Creating and publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages)).
- The npm CLI configuration references for the maintained bundled npm major
  versions describe `access` as public for a new package and retain
  `--access=public` as the explicit setting
  ([npm 10 `access`](https://docs.npmjs.com/cli/v10/using-npm/config#access),
  [npm 11 `access`](https://docs.npmjs.com/cli/v11/using-npm/config#access)).
- The current npm 12 reference gives the same public-new-package description
  ([npm 12 `access`](https://docs.npmjs.com/cli/v12/using-npm/config#access)).

The discrepancy means a release plan must not infer public visibility from the
package name alone. `npm publish --access public` is the documented explicit
public-publish form, and the resulting registry visibility should be verified.
This report does not choose the final release command or initial-publish
workflow.

A user's npm configuration can map a scope to a different registry. For
example, an `@flyingmt:registry` setting changes where npm resolves that scope
([Associating a scope with a registry](https://docs.npmjs.com/cli/v10/using-npm/scope#associating-a-scope-with-a-registry)).
Thus `npx @flyingmt/mdvl` does not necessarily contact the public npm registry
on every machine.

### `npx` and Executable Resolution

For maintained Node.js installations that bundle npm 10 or 11, the following
are valid npm package-spec forms:

```sh
npx @flyingmt/mdvl
npx @flyingmt/mdvl@latest
npx @flyingmt/mdvl@1.2.3
npm exec -- @flyingmt/mdvl
npm exec --package=@flyingmt/mdvl@1.2.3 -- mdvl
```

The current npm 12 CLI preserves the same package and executable model
([npm 10 `npx`](https://docs.npmjs.com/cli/v10/commands/npx),
[npm 10 `npm exec`](https://docs.npmjs.com/cli/v10/commands/npm-exec),
[npm 12 `npx`](https://docs.npmjs.com/cli/v12/commands/npx)). With the standalone
`npx` syntax, its own options must precede the positional package argument;
`npm exec` recommends `--` when separating npm options from executable
arguments.

When no command is supplied, npm infers the executable from the package's
`bin` metadata. It applies this order:

1. Use the sole `bin` entry if there is exactly one.
2. If there are multiple entries, use the one whose name matches the unscoped
   package name (`mdvl` here).
3. Treat multiple aliases that all point to the same file as one entry.
4. Exit with an error if no unambiguous entry remains.

Therefore, the preferred shorthand constrains the eventual package to expose
an unambiguous executable. A single `mdvl` entry, conceptually
`{"bin":{"mdvl":"<bootstrap-file>"}}`, is the direct form; this report does not
select the file path or decide whether aliases exist. npm creates executable
links or platform shims from `bin`, and a JavaScript command file must start
with an appropriate Node.js shebang
([package.json `bin`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin)).

An unqualified `npx @flyingmt/mdvl` is not an unconditional "download latest"
operation. If a matching dependency is already present in the local project,
npm adds that local executable to `PATH`; otherwise it installs the requested
package into the npm cache for the command. A requested package absent from the
local project can prompt before installation. Explicit versions and tags are
supported, but the user-facing default remains a package-contract decision
([npm 10 `npm exec` description](https://docs.npmjs.com/cli/v10/commands/npm-exec#description)).

### Manifest Constraints Relevant to a Bootstrapper

The package manifest can declare `engines.node`, but npm treats an incompatible
engine as advisory unless the user enables `engine-strict`
([package.json `engines`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#engines),
[`engine-strict`](https://docs.npmjs.com/cli/v10/using-npm/config#engine-strict)).
The eventual package should still declare and test its actual bootstrap Node.js
range; this research does not choose that range.

The `os` and `cpu` fields are independent allow/block lists
([package.json `os` and `cpu`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#os)).
Their independent evaluation cannot express a coupled matrix such as "Windows
x64 only, but macOS and Linux x64 plus arm64." If mdvl's supported platform
matrix has coupled OS/architecture rules, the bootstrap code must select or
reject the release artifact itself.

Install lifecycle scripts are not a reliable substitute for the explicit
`bin` command. npm users can disable lifecycle scripts with `ignore-scripts`,
while an explicitly invoked `bin` command still runs
([`ignore-scripts`](https://docs.npmjs.com/cli/v10/using-npm/config#ignore-scripts)).
Also, npm has not run `uninstall` lifecycle scripts since npm 7
([npm scripts life cycle operation order](https://docs.npmjs.com/cli/v10/using-npm/scripts#life-cycle-operation-order)).
Any mdvl uninstall behavior therefore has to belong to an explicit mdvl-owned
command, not npm package removal hooks.

These npm fields and hooks govern only the bootstrap package. They do not make
Node.js a runtime dependency of the installed native mdvl binary.

### Maintained Node.js and Bundled npm Snapshot

The Node.js release schedule defines which major lines are Current, Active LTS,
Maintenance LTS, or end-of-life. The following snapshot combines the official
schedule at commit
[`143dd650cab051b6d66176905da3d9f5f4236b55`](https://github.com/nodejs/Release/blob/143dd650cab051b6d66176905da3d9f5f4236b55/schedule.json)
with the official Node.js
[`index.json`](https://nodejs.org/download/release/index.json) observed on
2026-08-01:

| Node.js line | Schedule state | Latest release | Bundled npm |
| --- | --- | --- | --- |
| 22 | Maintenance LTS | 22.23.2 | 10.9.8 |
| 24 | Active LTS | 24.18.1 | 11.16.0 |
| 26 | Current | 26.5.1 | 11.17.0 |

Thus all maintained Node.js lines at the research date include the modern
`npm exec`-backed `npx` implementation, spanning npm majors 10 and 11. The
bootstrap package should be evaluated against these bundled versions, not only
against whichever npm release is newest independently.

For context, the public npm registry's
[`npm/latest`](https://registry.npmjs.org/npm/latest) document reported npm
12.0.2 with `engines.node` set to `^22.22.2 || ^24.15.0 || >=26.0.0`. The latest
release of each maintained Node line satisfies that range, but no maintained
line in the table bundled npm 12. This does not select npm 12 as an mdvl
requirement.

### Publication Security and Provenance

npm's current scoped-public-package guide says direct publication requires
either account 2FA or a granular access token with bypass 2FA enabled. It also
documents a staged path: staging does not require 2FA, but a maintainer must use
2FA to approve publication, and a token's bypass setting cannot bypass that
approval
([Creating and publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages)).
npm separately describes the baseline for package creation and publication as
2FA or a granular token with bypass 2FA, while package-settings changes require
2FA. The stronger per-package option disallows traditional tokens and requires
2FA for interactive publication; trusted OIDC publication remains permitted
([Requiring 2FA for a package](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification),
[Trusted publishing](https://docs.npmjs.com/trusted-publishers#recommended-restrict-token-access-when-using-trusted-publishers)).
The account's actual 2FA and package-security settings are authenticated facts
and were not inspected.

npm trusted publishing can replace a long-lived publish token with an OIDC
exchange from a configured CI workflow. It requires npm 11.5.1 or later and
Node.js 22.14.0 or later
([Trusted publishing](https://docs.npmjs.com/trusted-publishers)). In the table
above, the latest Node 24 and 26 releases satisfy both requirements with their
bundled npm versions; Node 22 satisfies the Node requirement but its bundled
npm 10 does not satisfy the npm requirement. This constrains the release
environment, not the bootstrap package's user-facing Node range.

The documented trusted-publisher configuration starts in an existing package's
npmjs.com settings. Initial package creation therefore still needs an
authorized path with scope access. This report does not choose direct versus
staged initial publication or identify the authorized human or workflow.

Supported CI publication can attach a provenance statement that links a
published package to its source repository and build environment
([Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements)).
Trusted publishing generates provenance automatically for GitHub Actions and
GitLab only when both the source repository and package are public; the current
trusted-publishing documentation excludes CircleCI from automatic provenance
([Trusted publishing](https://docs.npmjs.com/trusted-publishers#automatic-provenance-generation)).
Provenance and npm's package-integrity checks cover the package tarball
published to npm. They do not authenticate a platform binary that bootstrap
code downloads later. The installer must separately verify the selected mdvl
release artifact, including the map's required SHA-256 check.

Published name/version pairs are immutable: even when npm permits unpublishing,
the same name and version cannot later be reused
([Unpublishing packages](https://docs.npmjs.com/policies/unpublish)). Installer
package versions therefore need release discipline; a bad published version is
fixed with a new version, not by replacing its tarball.

### Registry Policy Constraints

The npm Open Source Terms prohibit unlawful or infringing content, malware,
name squatting, and package content whose purpose is advertising. They also
require package content to be functionally compatible with the npm command-line
client
([npm Open Source Terms](https://docs.npmjs.com/policies/open-source-terms)).
An mdvl bootstrap package must remain a real npm-compatible package and must
have the rights needed to redistribute its JavaScript bootstrap code and any
content included in its tarball.

Those terms govern the npm package. They do not replace the licensing,
integrity, ownership, or safe-update rules for native release artifacts fetched
at runtime.

## What Still Requires Human Account Confirmation

The public investigation cannot answer any of the following:

- Whether `flyingmt` is an npm user or organization controlled by the project.
- Whether a private `@flyingmt/mdvl` package already exists behind the public
  404.
- Which account or organization team has publish and settings permission.
- Whether that account satisfies npm's 2FA requirements.
- Whether the package already has public access, provenance, or a trusted
  publisher configured.
- Which authenticated path is authorized for the initial package creation.

These are the responsibility of the separate ticket,
[Confirm publish access to the `@flyingmt` npm scope](https://github.com/flyingmt/mdvl/issues/16).
No credential should be copied into that ticket; it should record only the
minimum confirmation and resulting permission state.

## Planning Consequences, Not Package Decisions

- The public package was not resolvable on 2026-08-01; planning must not assume
  that `npx @flyingmt/mdvl` works today.
- The preferred shorthand requires an unambiguous inferred executable, with
  `mdvl` as the matching unscoped command name.
- Public visibility must be explicit and verified because official npm guidance
  disagrees about the initial scoped-package default.
- Compatibility testing should cover the maintained Node 22, 24, and 26 lines
  with their bundled npm 10 and 11 versions.
- npm lifecycle hooks cannot own mdvl uninstall behavior, and npm manifest
  platform filters cannot encode a coupled OS/architecture matrix.
- npm 2FA, trusted publishing, provenance, and immutable versions constrain the
  publication workflow, while SHA-256 verification separately constrains the
  runtime artifact download.
- Scope ownership, hidden package state, and actual publish access remain human
  confirmation facts, not conclusions from the anonymous 404.

This report deliberately does not choose the final `package.json`, default
version/tag behavior, bootstrap implementation, supported Node range,
publication credential flow, or initial-release ordering.
