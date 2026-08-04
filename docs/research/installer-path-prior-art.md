# How battle-tested installers write the Windows User PATH

- Research date: 2026-08-04
- Ticket: [flyingmt/mdvl#31][I31] — part of the map [#27 Windows 설치가 User PATH를 지운다][I27]
- Decision owner: [#32 mdvl이 Windows User PATH를 소유하는 방식을 확정한다][I32]

## Scope

Seven shipped installers were read at source level to answer one question: **what
code runs when they put their own directory on `HKEY_CURRENT_USER\Environment\Path`?**
For each: mechanism, backup, read-failure policy, `REG_EXPAND_SZ` handling, length
handling, and any public incident where the installer destroyed a user's PATH.

Platform-API facts (`Environment.SetEnvironmentVariable`, `RegSetValueExW`,
`WM_SETTINGCHANGE`, registry value types, environment length limits) are **not**
re-derived here — they were settled in
[`docs/research/user-path-conventions.md`](./user-path-conventions.md) for [#11][I11].
This report cites Microsoft only where a documented `setx` behaviour is the direct
cause of a real incident.

This report maps what others do. It does not choose mdvl's mechanism — that is [#32][I32].

Labels used below:

- **Fact** — read directly from the cited source file at the cited commit.
- **Implication** — a conclusion drawn for [#32][I32], not a decision made here.

## Short answer

- **Consensus mechanism: a typed, direct registry write to `HKEY_CURRENT_USER\Environment`,
  value name `Path`, always written back as `REG_EXPAND_SZ`.** Five of seven do this
  (rustup, uv/cargo-dist, bun, winget, and pnpm via `reg add /t REG_EXPAND_SZ`).
  The two that use `setx` to write — volta and nvm-windows' `install.cmd` — are the
  two with open "you broke my PATH" issues.
- **Consensus failure policy: fail-closed. Not one of the seven treats an unreadable
  PATH as an empty PATH.** rustup returns a sentinel that suppresses the write, pnpm
  returns `PathExtenderError::NoPath`, bun and uv run under conditions where a failed
  read raises and aborts the script. The destructive pattern — read fails, substitute
  `""`, write anyway — appears in **none** of them. It is what mdvl does today
  (`installer/lib/shells.js:215-217`).
- **Consensus on "absent" vs. "unreadable": they are different states and must be
  distinguished.** rustup is the clearest: `ERROR_FILE_NOT_FOUND` → `Some(empty)`
  (legitimately no PATH, safe to create), `ERROR_INVALID_DATA` → `None` (unreadable,
  do nothing). pnpm collapses both into an abort. Nobody collapses both into "write".
- **Consensus on backup: none of the seven back up the original value anywhere.**
  The industry answer to "where is the backup?" is "there is no backup, because a
  correct writer never writes a value it did not successfully read." rustup's
  snapshot/restore code exists only in its **test** fixture, not the install path.
- **The read is the dangerous step, not the write.** Every incident found below is a
  read-or-transport defect: `setx` cropping at 1024 characters, `setx` expanding
  `%VAR%` references, a code page mangling non-ASCII on the way out of `reg query`,
  or a registry read whose failure was not checked.

## Comparison

| Installer | Read | Write | Read fails → | Type on write | Backup |
|---|---|---|---|---|---|
| **rustup** | `windows-registry` typed get on `HKCU\Environment` | typed set, same crate | **abort** (`Ok(None)` → no write) | forced `REG_EXPAND_SZ`; deletes value if empty | no |
| **uv** (cargo-dist) | `.GetValue('Path','','DoNotExpandEnvironmentNames')` | `Set-ItemProperty -Type ExpandString` | throws → top-level `catch` → `exit 1` | forced `REG_EXPAND_SZ` | no |
| **bun** | `RegistryKey.GetValue(..., DoNotExpandEnvironmentNames)` | `RegistryKey.SetValue` | `$ErrorActionPreference = "Stop"` → abort | preserves existing kind; `ExpandString` if value has `%` | no |
| **pnpm** | `reg query` (whole key) under `chcp 65001` | `reg add /t REG_EXPAND_SZ /f` | **abort** (`PathExtenderError::NoPath`) | forced `REG_EXPAND_SZ` | no |
| **volta** | `winreg` typed get (correct) | **`setx`** (lossy) | abort (`ReadUserPathError`) | whatever `setx` produces — `REG_SZ`, expanded | no |
| **nvm-windows** | Inno `RegQueryStringValue`, **result discarded** | `RegWriteExpandStringValue`; `install.cmd` uses `setx /M` | **unchecked** — writes whatever the variable holds | `REG_EXPAND_SZ` from Inno; `REG_SZ` from `setx` | no |
| **winget** | `Registry::Key` typed get on `HKCU\Environment` | `SetValue(..., REG_EXPAND_SZ)` | no empty-default branch; throws | forced `REG_EXPAND_SZ` | no |
| **gh** | — | MSI `<Environment>` table (machine scope) | Windows Installer owns it | engine-managed | MSI rollback |
| **mdvl today** | `reg query /v Path` + regex | `reg add /f` | **`currentUserPath = ""` and writes** | `%`-heuristic | no |

## Per-installer findings

### rustup — the reference implementation

Source: [`src/cli/self_update/windows.rs`](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs)
at `62df1e9`.

**Fact — the read distinguishes three outcomes** ([L495-L513](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs#L495-L513)):

```rust
fn get_windows_path_var() -> Result<Option<HSTRING>> {
    let environment = CURRENT_USER
        .create("Environment")
        .context("Failed opening Environment key")?;

    let reg_value = environment.get_hstring("PATH");
    match reg_value {
        Ok(val) => Ok(Some(val)),
        Err(e) if e.code() == HRESULT::from_win32(ERROR_INVALID_DATA) => {
            warn!(
                "the registry key HKEY_CURRENT_USER\\Environment\\PATH is not a string. \
                   Not modifying the PATH variable"
            );
            Ok(None)
        }
        Err(e) if e.code() == HRESULT::from_win32(ERROR_FILE_NOT_FOUND) => Ok(Some(HSTRING::new())),
        Err(e) => Err(e).context(CliError::WindowsUninstallMadness),
    }
}
```

Three states, three answers: readable → the value; **wrong type → `Ok(None)`, meaning
"do not touch PATH"**; genuinely absent → `Ok(Some(""))`, meaning "there is no PATH, it
is safe to create one". Any other error propagates and aborts.

**Fact — `None` is threaded all the way to the write, where it becomes a no-op.**
`_with_path_cargo_home_bin` uses `windows_path.and_then(...)`
([L561](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs#L561)),
so a `None` read short-circuits the whole computation, and
`_apply_new_path` ([L456-L491](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs#L456-L491))
opens with:

```rust
    let Some(new_path) = new_path else {
        return Ok(()); // No need to set the path
    };
```

`None` is deliberately overloaded to mean both "unreadable" and "no change needed" —
both are cases where the correct action is to write nothing.

**Fact — the write forces `REG_EXPAND_SZ`, and an empty result deletes the value
rather than storing `""`** (same function):

```rust
    if new_path.is_empty() {
        environment.remove_value("PATH")?;
    } else {
        environment.set_expand_hstring("PATH", &new_path)?;
    }
```

followed by `SendMessageTimeoutA(HWND_BROADCAST, WM_SETTINGCHANGE, 0, c"Environment", SMTO_ABORTIFHUNG, 5000, ...)`.

**Fact — no length check anywhere.** rustup never truncates and never refuses on
length; because it does a typed registry write rather than `setx`, the 1024-character
crop does not apply to it.

**Fact — no backup on the install path.** The snapshot/restore code (`RegistryGuard`,
[L763](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs#L763))
is `#[cfg(any(test, feature = "test"))]`: it captures `HKCU\Environment\PATH` before a
test and restores it on `Drop`, serialised by a `REGISTRY_LOCK` mutex.

**Fact — each of these behaviours has a named regression test**
([L864-L967](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs#L864-L967)):

| Test | What it pins |
|---|---|
| `windows_path_regkey_type` | writes must land as `Type::ExpandString`; comment: *"per issue #261, setting PATH should use REG_EXPAND_SZ."* |
| `windows_path_delete_key_when_empty` | an empty result deletes the value, does not write `""` |
| `windows_doesnt_mess_with_a_non_string_path` | writes `Type::Bytes` into `PATH`, asserts the change layer returns `None` **and** asserts the exact warning text |
| `windows_treat_missing_path_as_empty` | a missing value reads back as `Some("")`, not an error |
| `windows_uninstall_removes_semicolon_from_path_{prefix,suffix}` | uninstall leaves no stray `;` |

`windows_doesnt_mess_with_a_non_string_path` passes a closure `|_, _| panic!("called")`
as the transform, so the test fails loudly if the code ever *reaches* the mutation step
on an unreadable PATH.

**Incidents.**

| Issue | Root cause | Fix |
|---|---|---|
| [rustup#261](https://github.com/rust-lang/rustup/issues/261) (2016-04-04) "[win] rustup setting wrong registry type for PATH" | PATH written as `REG_SZ`, destroying `%VAR%` references | switched to `REG_EXPAND_SZ`; pinned by `windows_path_regkey_type` |
| [rustup#265](https://github.com/rust-lang/rustup/issues/265) (2016-04-05) "Non-unicode values of `HKCU\Environment\PATH` are not handled" — *"This registry key is modified on install and uninstall. If it contains a non-unicode value rustup will panic."* | non-UTF-8 PATH | [PR#2649](https://github.com/rust-lang/rustup/pull/2649) "Handle PATHs with non-unicodes values on Windows" — the `Ok(None)` fail-closed branch above. Took ~5 years to close. |
| [rustup#264](https://github.com/rust-lang/rustup/pull/264) "Multiple fixes for windows registry handling" | — | same era as #261 |

**Implication:** the fail-closed branch that mdvl lacks is exactly what rustup added to
fix #265, and rustup considered the behaviour important enough to assert the *warning
string itself* in a test.

### uv — cargo-dist's `installer.ps1`

uv ships no `.ps1` in-tree; the script users run is generated by
[cargo-dist](https://github.com/axodotdev/cargo-dist) from
[`cargo-dist/templates/installer/installer.ps1.j2`](https://github.com/axodotdev/cargo-dist/blob/25b2af882b1641c6ae50bc81c11ec174b8a6e1d8/cargo-dist/templates/installer/installer.ps1.j2)
and published at `https://astral.sh/uv/install.ps1`. Quotes below are from the released
script for uv 0.12.1.

**Fact — the read is explicitly unexpanded, and the comments say why:**

```powershell
function Add-Path($LiteralPath) {
  $RegistryPath = 'registry::HKEY_CURRENT_USER\Environment'

  # Note the use of the .GetValue() method to ensure that the *unexpanded* value is returned.
  # If 'Path' is not an existing item in the registry, '' is returned.
  $CurrentDirectories = (Get-Item -LiteralPath $RegistryPath).GetValue('Path', '', 'DoNotExpandEnvironmentNames') -split ';' -ne ''

  if ($LiteralPath -in $CurrentDirectories) { return $false }

  $NewPath = (,$LiteralPath + $CurrentDirectories) -join ';'

  # Update the registry. Will create the property if it did not already exist.
  # Note the use of ExpandString to create a registry property with a REG_EXPAND_SZ data type.
  Set-ItemProperty -Type ExpandString -LiteralPath $RegistryPath Path $NewPath
```

`-split ';' -ne ''` drops empty entries, so a trailing `;` cannot create a blank PATH
element. The write is unconditionally `REG_EXPAND_SZ`.

**Fact — failure aborts the installer.** `Get-Item` failing makes the subsequent
`.GetValue(...)` a method call on `$null`, which is a terminating error; the script's
entry point is `try { Install-Binary "$Args" } catch { Write-Information $_; exit 1 }`.
No branch substitutes an empty PATH and proceeds.

**Fact — the broadcast is a dummy-variable trick, not a P/Invoke:**

```powershell
  $DummyName = 'cargo-dist-' + [guid]::NewGuid().ToString()
  [Environment]::SetEnvironmentVariable($DummyName, 'cargo-dist-dummy', 'User')
  [Environment]::SetEnvironmentVariable($DummyName, [NullString]::value, 'User')
```

This is deliberate: `[Environment]::SetEnvironmentVariable` broadcasts `WM_SETTINGCHANGE`
for free, so they use it on a *throwaway* name while keeping `Path` itself on the
registry path that preserves `REG_EXPAND_SZ`. Added in
[cargo-dist#1657](https://github.com/axodotdev/cargo-dist/pull/1657) "Notify processes to
refresh their environment variables".

**Fact — no backup, no length check.** The function's provenance is credited in-source
to a StackOverflow answer on adding to PATH permanently.

**Incidents:** no report found of the uv/cargo-dist PowerShell installer destroying a
user PATH.

**Implication:** mdvl's current dummy-variable broadcast
(`installer/lib/shells.js:242-249`) is this pattern already — mdvl copied the safe
*broadcast* from this family while not copying the safe *read*.

### bun

Source: [`src/runtime/cli/install.ps1`](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/install.ps1)
at `d6a03fc`; the same three helpers are duplicated in `uninstall.ps1`.

**Fact — bun rejects the .NET setter by name, with the reason in a comment**
([L36-L39](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/install.ps1#L36-L39)):

```powershell
$ErrorActionPreference = "Stop"

# These three environment functions are roughly copied from https://github.com/prefix-dev/pixi/pull/692
# They are used instead of `SetEnvironmentVariable` because of unwanted variable expansions.
```

**Fact — read and write go through the raw `RegistryKey` API**
([L62-L90](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/install.ps1#L62-L90)):

```powershell
function Write-Env {
  param([String]$Key, [String]$Value)
  $RegisterKey = Get-Item -Path 'HKCU:'
  $EnvRegisterKey = $RegisterKey.OpenSubKey('Environment', $true)
  if ($null -eq $Value) {
    $EnvRegisterKey.DeleteValue($Key)
  } else {
    $RegistryValueKind = if ($Value.Contains('%')) {
      [Microsoft.Win32.RegistryValueKind]::ExpandString
    } elseif ($EnvRegisterKey.GetValue($Key)) {
      $EnvRegisterKey.GetValueKind($Key)
    } else {
      [Microsoft.Win32.RegistryValueKind]::String
    }
    $EnvRegisterKey.SetValue($Key, $Value, $RegistryValueKind)
  }
  Publish-Env
}

function Get-Env {
  param([String] $Key)
  $RegisterKey = Get-Item -Path 'HKCU:'
  $EnvRegisterKey = $RegisterKey.OpenSubKey('Environment')
  $EnvRegisterKey.GetValue($Key, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}
```

Note the type ladder: `%` present → `ExpandString`; else **preserve the value's existing
kind via `GetValueKind`**; else `String`. bun is the only surveyed installer that
preserves the original type rather than forcing one.

**Fact — read failure aborts.** `$ErrorActionPreference = "Stop"` plus a `.GetValue` on
a failed `OpenSubKey` terminates the script. Deletion is expressed as
`Write-Env -Value $null` → `DeleteValue`, i.e. bun also avoids storing `""`.

**Fact — the broadcast is a real `SendMessageTimeout` P/Invoke** (`Publish-Env`,
[L40-L60](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/install.ps1#L40-L60)),
`HWND_BROADCAST`, `WM_SETTINGCHANGE = 0x1a`, `lParam = "Environment"`, 5000 ms timeout.

**Fact — no backup, no length check.** Mutation site
([L302-L307](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/install.ps1#L302-L307)):

```powershell
    $Path = (Get-Env -Key "Path") -split ';'
    if ($Path -notcontains $BunBin) {
      ...
      $Path += $BunBin
      Write-Env -Key 'Path' -Value ($Path -join ';')
```

**Incidents:** no report found of `install.ps1` destroying a user PATH.

### pnpm — same mechanism as mdvl, three defences mdvl lacks

`pnpm setup` is now Rust. Source:
[`pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs`](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs)
at `46d7d3e`. **This is the closest analogue to mdvl's code — it also shells out to
`reg query` and `reg add`** — which makes its defences the most directly transferable.

**Fact — the module header states the whole design**
([L1-L7](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L1-L7)):

```rust
//! The registry is read with `reg query`, the proxy variable and `Path`
//! are written with `reg add`, and a dummy `setx` forces the new values to
//! be picked up by future processes. `chcp 65001` makes `reg` emit UTF-8
//! so non-ASCII values survive the round-trip.
```

**Defence 1 — code page.** Before any `reg` call, and restored even on failure
([L23-L44](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L23-L44)):

```rust
    // `chcp` makes `reg` use UTF-8 for output. Otherwise non-ASCII
    // characters in environment variables become garbled.
    let chcp_output = run_capture("chcp", &[])...;
    let cp_bak = first_number(&chcp_output)...;
    run_capture("chcp", &["65001"])?;

    let result = (|| { ... })();

    // Restore the original code page even when the body failed.
    let _ = run_capture("chcp", &[&cp_bak.to_string()]);
    result
```

**Defence 2 — fail-closed on a missing or blank PATH**
([L108-L118](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L108-L118)):

```rust
    let path_data = get_env_value_from_registry(registry_output, variable);
    let path_data = match path_data {
        Some(data) if !data.trim().is_empty() => data,
        _ => return Err(PathExtenderError::NoPath),
    };
```

A user PATH that cannot be found or parsed is a hard error, never an empty string.

**Defence 3 — a failed subprocess is an error, not empty output.** Two comments name
mdvl's bug directly
([L138-L157](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L138-L157)):

```rust
/// Read every value under [`REG_KEY`] and pick the one we need, rather than
/// querying a single value (which fails when the value is absent and hides
/// the real cause).
fn get_registry_output() -> Result<String, PathExtenderError> {
    run_capture("reg", &["query", REG_KEY]).map_err(|_| PathExtenderError::RegRead)
}

/// Run a command and capture stdout, returning an error if it cannot be
/// spawned or exits non-zero — rather than silently continuing with empty
/// output.
fn run_capture(program: &str, args: &[&str]) -> Result<String, PathExtenderError> { ... }
```

pnpm queries the **whole key** (`reg query HKEY_CURRENT_USER\Environment`) instead of
`/v Path`, precisely so that "value absent" is distinguishable from "command failed".

**Fact — the parser is case-insensitive** and validates the type column
([L159-L185](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L159-L185)):
`rest[..env_var_name.len()].eq_ignore_ascii_case(env_var_name)`, four-space separators,
and the type token must be alphanumeric/underscore.

**Fact — the write is always `REG_EXPAND_SZ` for `Path`**
([L130](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L130),
[L187-L204](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L187-L204)):
`set_env_var_in_registry("Path", &new_path_value, true)` → `/t REG_EXPAND_SZ`, and a
non-zero `reg add` exit becomes `PathExtenderError::FailedSetEnv`.

**Fact — `setx` is used only as a broadcast trigger, never to carry PATH**
([L206-L214](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L206-L214)):

```rust
/// Registry writes are not seen by future processes until at least one
/// variable is set with `setx`. Set and immediately delete a throwaway
/// variable to trigger the broadcast.
fn refresh_env_vars() -> Result<(), PathExtenderError> {
    const TEMP_ENV_VAR: &str = "REFRESH_ENV_VARS";
    run_capture("setx", &[TEMP_ENV_VAR, "1"])?;
    run_capture("reg", &["delete", REG_KEY, "/v", TEMP_ENV_VAR, "/f"])?;
```

Same idea as cargo-dist's dummy variable: the lossy tool touches only a name nobody cares about.

**Fact — no backup, but the old value is surfaced.** `EnvVariableChange { variable,
old_value: Option<String>, new_value }`
([L12-L19](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs#L12-L19))
exists "to render the before/after report" — the user sees what changed, but nothing is
persisted for recovery.

**Fact — no length check.**

**Incidents.**

| Issue | Root cause | Fix |
|---|---|---|
| [pnpm#4698](https://github.com/pnpm/pnpm/issues/4698) (2022-05-08, closed) "pnpm setup breaks PATH with non-ascii characters" — expected `path=pnpm_path;目录1;目录2`, actual `path=pnpm_path;Ŀ¼1;Ŀ¼2`; reporter adds *"pnpm setup on non-English windows, the output is garbled"* | `reg query` emitted in the console's OEM code page; the mojibake was written straight back | the `chcp 65001` round-trip above |
| [pnpm#12282](https://github.com/pnpm/pnpm/issues/12282) (open) "pnpm setup --force deletes shell config content between duplicate pnpm blocks (greedy regex)" | greedy regex over a config file | Unix-side, but the same class: parsing a text surface to decide what to overwrite |

**Implication:** #4698 is mdvl's "한글 경로" destructive case from [#27][I27], already
reported and fixed by someone using the identical `reg query`/`reg add` mechanism. The
fix is a code page, not a rewrite.

### volta — correct read, lossy write

Source: [`src/command/setup.rs`](https://github.com/volta-cli/volta/blob/5eedd5fb2f682baceb47a242289111fcd79435a5/src/command/setup.rs#L236-L265)
at `5eedd5f`, `#[cfg(windows)] mod os`:

```rust
    pub fn setup_environment() -> Fallible<()> {
        let shim_dir = volta_home()?.shim_dir().to_string_lossy().to_string();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env = hkcu
            .open_subkey("Environment")
            .with_context(|| ErrorKind::ReadUserPathError)?;
        let path: String = env
            .get_value("Path")
            .with_context(|| ErrorKind::ReadUserPathError)?;

        if !path.contains(&shim_dir) {
            // Use `setx` command to edit the user Path environment variable
            let mut command = Command::new("setx");
            command.arg("Path");
            command.arg(format!("{};{}", shim_dir, path));
```

**Fact — the read is exemplary and the write is the bug.** Both `open_subkey` and
`get_value` propagate with `?`, so a failed read aborts with `ReadUserPathError` — volta
never writes an unread PATH. It then hands the whole assembled value to `setx`, which
Microsoft documents as destructive on exactly this input:

> "Running this command on an existing variable removes any variable references and uses
> expanded values. […] Be aware there's a limit of 1024 characters when assigning contents
> to a variable using **setx**. This means that the content is cropped if you go over 1024
> characters […] If this cropped text is applied to an existing variable, it can result in
> loss of data previously held by the target variable." — [setx](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setx)

**Fact — the containment test is a substring test**, `!path.contains(&shim_dir)`, not an
entry-wise comparison.

**Fact — no backup, no length check.**

**Incidents.**

| Issue | Root cause | Status |
|---|---|---|
| [volta#1933](https://github.com/volta-cli/volta/issues/1933) (2024-11-05, **open**) "Installation breaks PATH on Windows" — *"My machine got messed up […] The `setx` command limits variables to length 1024. The proper solution is to write using the registry as that code in the first link does for reading."* | `setx` crop | open |
| [volta#1931](https://github.com/volta-cli/volta/pull/1931) (2024-11-04, **open**) "Write registry values directly to avoid Path environment variable truncation." — *"setx will truncate the path to 1024 characters. […] This PR directly uses writing registry values instead of spawning the `setx` command."* | — | PR open, unmerged as of this research date |

**Implication:** volta proves that a fail-closed read is not sufficient on its own. The
transport must also be lossless. It also shows the community's independent verdict —
"write the registry directly" — arrived at by a user reading the same code.

### nvm-windows — the cautionary tale

Two separate PATH writers.

**Fact — the Inno Setup script discards the read result.**
[`nvm.iss`](https://github.com/coreybutler/nvm-windows/blob/5b18223ca19ff50d707f35410dbc6bd440a9f74d/nvm.iss#L107-L136)
at `5b18223`, `procedure TakeControl`:

```pascal
  RegQueryStringValue(HKEY_CURRENT_USER,
    'Environment',
    'Path', path);

  StringChangeEx(path,np+'\','',True);
  StringChangeEx(path,np,'',True);
  StringChangeEx(path,np+';;',';',True);

  RegWriteExpandStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', path);
```

`RegQueryStringValue` is declared
`function RegQueryStringValue(const RootKey: HKEY; const SubKeyName, ValueName: String; var ResultStr: String): Boolean`
([Inno Setup script functions](https://jrsoftware.org/ishelp/topic_scriptfunctions.htm)) —
its Boolean result is never checked here, and the docs give no guarantee about `ResultStr`
on failure. The same unchecked pattern repeats in `InitializeUninstall`
([L386-L434](https://github.com/coreybutler/nvm-windows/blob/5b18223ca19ff50d707f35410dbc6bd440a9f74d/nvm.iss#L386-L434)),
where the single `path` variable is reused for the machine PATH read at L413 and then the
user PATH read at L423 before being written back to `HKCU` at L431.

**Fact — the type is right.** `RegWriteExpandStringValue` writes `REG_EXPAND_SZ`, which
matters because nvm stores `%NVM_HOME%` / `%NVM_SYMLINK%` references in PATH and strips
them literally on uninstall.

**Fact — `assets/install.cmd` uses `setx /M`**, which is the documented 1024-character
cropper, and is the subject of the incidents below.

**Fact — no backup, no length check, no read-failure branch.**

**Incidents — the longest-running unfixed PATH destruction found in this survey.**

| Issue | Root cause | Status |
|---|---|---|
| [nvm-windows#224](https://github.com/coreybutler/nvm-windows/issues/224) (2016-11-13, **open**) "`install.cmd` is destroying the %PATH% because `setx` command is limited to 1024 characters" | `setx` crop | open ~9 years |
| [nvm-windows#546](https://github.com/coreybutler/nvm-windows/issues/546) (2020-06-05, **open**) "Install.cmd Deletes PATH environment data" | same | open |
| [nvm-windows#662](https://github.com/coreybutler/nvm-windows/issues/662) (2021-09-10, closed) "Install.cmd truncates %PATH% to 1024 variables" — *"`setx /M PATH "%PATH%;%NVM_HOME%;%NVM_SYMLINK%"` […] truncates `%PATH%` to first 1024 symbols […] I had to restore my `%PATH%` after this. Thanks to backups, I had a quick way to do it via loading registry hive […] But this might be much more painful for other people who didn't have a backup"* | same | closed |

**Implication:** the recovery story in #662 is the argument *for* fail-closed. The only
reason that user recovered is that Windows, not the installer, had a registry backup. An
installer that never writes an unverified value never needs one.

### winget and gh

**winget-cli — Microsoft's own reference.**
[`src/AppInstallerCommonCore/PathVariable.cpp`](https://github.com/microsoft/winget-cli/blob/3e2887e7b303ac377a550d9bbfd77e02d6a8f380/src/AppInstallerCommonCore/PathVariable.cpp)
at `3e2887e`. Direct registry API on `HKEY_CURRENT_USER\Environment` value `Path`
(L13-L15, L41-L65). Write (L118-L126):

```cpp
    void PathVariable::SetPathValue(const std::string& value)
    {
        THROW_HR_IF(E_ACCESSDENIED, m_readOnly);
        std::wstring pathName = std::wstring{ s_PathName };
        m_key.SetValue(pathName, ConvertToUTF16(value), REG_EXPAND_SZ);
        SendNotifyMessageW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, (LPARAM)TEXT("Environment"));
    }
```

Always `REG_EXPAND_SZ`; broadcast on every write; a read-only handle throws rather than
writes. `GetPathValue()` is `Normalize(m_key[pathName]->GetValue<Value::Type::String>())`
— there is **no branch that produces an empty default**; a missing or wrong-typed value
raises. `Contains` is a substring search (L73-L77), the same weak equivalence test volta
uses. No backup, no length check. Expansion is done only for the *process* environment
(`RefreshPathVariableForCurrentProcess`, L128-L134), never for the stored value —
the comment says *"Path values must be expanded before assigning to process environment
for proper refresh."*

**gh — does not hand-write the user PATH.** Its Windows package is an MSI;
[`build/windows/gh.wxs`](https://github.com/cli/cli/blob/e83adbc0642994fae7c39a9a012eb34b8c81f4f1/build/windows/gh.wxs#L54)
at `e83adbc` declares:

```xml
<Environment Id="Path" Action="set" Name="PATH" Part="last" System="yes" Value="[INSTALLDIR]"/>
```

`System="yes"` is machine scope, and the read-modify-write plus rollback is owned by the
Windows Installer engine, with `<CustomActionRef Id="WixBroadcastEnvironmentChange" />`
(L71) for the notification. A legacy component removes an old **user**-scope entry with
`Action="remove" … System="no"` (L66). **Implication:** gh is out of scope as a
mechanism model — it is per-machine and needs elevation, which [#27][I27] rules out — but
it is the one entry in this survey with real transactional rollback, and it gets that by
delegating to the platform rather than by keeping its own backup.

## Cross-cutting patterns

**1. Never let a failed read become an empty value.** No surveyed installer contains a
branch that substitutes `""` for an unreadable PATH and then writes. The mechanisms
differ (Rust `Result`/`Option`, PowerShell `$ErrorActionPreference = "Stop"`, C++
exceptions); the policy does not. nvm-windows is the weakest — it does not *check* the
read at all, so a failed read leaves stale data in the target variable — and it is the
one project in this survey with open, years-old PATH-destruction issues.

**2. Distinguish "absent" from "unreadable".** Only rustup makes this explicit
(`ERROR_FILE_NOT_FOUND` → create; `ERROR_INVALID_DATA` → abort). pnpm aborts on both,
which is safe but refuses to help a user whose PATH genuinely does not exist. Nobody
writes on both.

**3. Read the raw, unexpanded value.** rustup (typed registry get), uv
(`DoNotExpandEnvironmentNames`), bun (`RegistryValueOptions::DoNotExpandEnvironmentNames`),
winget (typed get), pnpm (`reg query`) all read what is stored, not what it expands to.
Every tool that reads an expanded value — `setx`, `%PATH%`, `$env:PATH` — appears in an
incident.

**4. Write `REG_EXPAND_SZ`.** Six of seven force or preserve it. bun is the only one
that preserves the *existing* kind instead of forcing; rustup, uv, pnpm, winget, and
nvm's Inno path force `REG_EXPAND_SZ` unconditionally. Nobody decides the type by
inspecting the string for `%` **except** bun (as one branch of a three-way ladder) — and
mdvl, which uses that heuristic as its only rule.

**5. `setx` is for the notification, not the payload.** cargo-dist and pnpm both use a
throwaway variable purely to trigger `WM_SETTINGCHANGE`; the two projects that used
`setx` to carry PATH itself (volta, nvm-windows) both have open truncation issues.

**6. Nobody backs up.** Zero of seven persist the prior value. Two have snapshot/restore
code, and in both cases it is test infrastructure (rustup's `RegistryGuard`) or the
platform's (MSI rollback). The stated alternative to a backup is: only ever write a
value you successfully read, and abort otherwise.

**7. Nobody guards length.** No surveyed installer refuses to write a long PATH. Length
is treated as a transport problem solved by not using `setx`, not as a policy limit.

**8. Deletion beats writing `""`.** rustup deletes the value when the result is empty
(with a dedicated test); bun's `Write-Env -Value $null` calls `DeleteValue`. Nobody
stores an empty string.

## What this means for mdvl

**Implication — mdvl's current read is the outlier.**
`installer/lib/shells.js:208-217` is the one pattern this survey found nowhere else:

```javascript
    const match = output.match(/Path\s+REG(?:_EXPAND_)?SZ\s+(.*)/);
    currentUserPath = match ? match[1].trim() : "";
  } catch {
    currentUserPath = "";
  }
```

Both branches convert "I could not read your PATH" into "your PATH is empty", and
`configureWindowsPath` then writes `normalized + ";" + ""` with `reg add /f`. pnpm's
`run_capture` doc comment names this exact behaviour as the thing to avoid: *"returning
an error if it cannot be spawned or exits non-zero — rather than silently continuing with
empty output."*

**Implication — install and uninstall are asymmetric today, by accident.**
`removeWindowsPath` (`installer/lib/shells.js:294-312`) has the same regex fallback, but
because a `""` read produces `newPath === currentUserPath`, the `if` guard suppresses the
write. Uninstall survives the parse failure; install does not. Any fix should not rely on
that coincidence.

**Implication — three of mdvl's listed destructive cases already have documented prior
art and fixes:**

| [#27][I27] case | Prior art | Their fix |
|---|---|---|
| 한글 경로 (non-ASCII) | [pnpm#4698](https://github.com/pnpm/pnpm/issues/4698) | `chcp 65001` around the `reg` round-trip, restored in all paths |
| `%VAR%` references | [rustup#261](https://github.com/rust-lang/rustup/issues/261) | force `REG_EXPAND_SZ` on write; never read an expanded value |
| Path 부재 / 대문자 `PATH` | [rustup#265](https://github.com/rust-lang/rustup/issues/265), pnpm `get_env_value_from_registry` | separate "absent" from "unreadable"; match the value name case-insensitively |

mdvl's regex requires the literal casing `Path` and stops at the first newline; registry
value names are case-insensitive, so a value stored as `PATH` parses as no-match, which
today means wipe.

**Implication — the regression tests [#27][I27] asks for already exist upstream in a
form worth copying.** rustup's four PATH tests plus its `RegistryGuard`
(snapshot the real `HKCU\Environment\PATH`, restore on `Drop`, serialised by a mutex)
are a working answer to the open question in [#27][I27] about whether the destructive
cases can run against a real registry on a Windows runner. They can — rustup does it,
and asserts the warning text so the fail-closed branch cannot silently regress.

**Implication — the 2048-character `throw` in `configureWindowsPath` has no counterpart
in any surveyed installer.** None of the seven imposes a length policy. Whether mdvl
keeps one is a [#32][I32] decision, but it should be justified on its own terms, not as
protection against a `setx` limit mdvl does not use.

## What this report does not settle

- Whether mdvl writes via `reg.exe` (pnpm's route, keeps the current dependency profile)
  or a direct registry API (rustup/winget's route, needs a Node binding or the Rust
  binary to do it). Both are represented among fail-closed implementations.
- What a fail-closed install should do about the already-written binary and receipt —
  [#27][I27] flags this as unowned, and no surveyed installer offers a model, because
  none of them treats the PATH step as recoverable.
- Whether mdvl should distinguish absent-vs-unreadable like rustup or abort on both like
  pnpm. rustup's split is friendlier on a fresh profile; pnpm's is simpler to test.
- Whether the 1024-character concern applies at all once `setx` is out of the write path.

## Sources

All source quotes are pinned to a commit SHA and were read at the URLs below on the
research date.

- rustup — [`src/cli/self_update/windows.rs` @ 62df1e9](https://github.com/rust-lang/rustup/blob/62df1e988b995b4410acbf36fde56f43111f72ad/src/cli/self_update/windows.rs)
- uv / cargo-dist — released [`https://astral.sh/uv/install.ps1`](https://astral.sh/uv/install.ps1) (uv 0.12.1), generated from [`cargo-dist/templates/installer/installer.ps1.j2` @ 25b2af8](https://github.com/axodotdev/cargo-dist/blob/25b2af882b1641c6ae50bc81c11ec174b8a6e1d8/cargo-dist/templates/installer/installer.ps1.j2)
- bun — [`src/runtime/cli/install.ps1` @ d6a03fc](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/install.ps1), [`src/runtime/cli/uninstall.ps1`](https://github.com/oven-sh/bun/blob/d6a03fc3685074c541dc6feaef53cd29a571d108/src/runtime/cli/uninstall.ps1)
- pnpm — [`pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs` @ 46d7d3e](https://github.com/pnpm/pnpm/blob/46d7d3eb7d8e67983906ba7a572305956f897867/pnpm/crates/cli/src/cli_args/setup/path_extender/windows.rs)
- volta — [`src/command/setup.rs` @ 5eedd5f](https://github.com/volta-cli/volta/blob/5eedd5fb2f682baceb47a242289111fcd79435a5/src/command/setup.rs#L236-L265)
- nvm-windows — [`nvm.iss` @ 5b18223](https://github.com/coreybutler/nvm-windows/blob/5b18223ca19ff50d707f35410dbc6bd440a9f74d/nvm.iss), `assets/install.cmd`
- winget — [`src/AppInstallerCommonCore/PathVariable.cpp` @ 3e2887e](https://github.com/microsoft/winget-cli/blob/3e2887e7b303ac377a550d9bbfd77e02d6a8f380/src/AppInstallerCommonCore/PathVariable.cpp)
- gh — [`build/windows/gh.wxs` @ e83adbc](https://github.com/cli/cli/blob/e83adbc0642994fae7c39a9a012eb34b8c81f4f1/build/windows/gh.wxs)
- Microsoft — [setx](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setx) (1024-character crop, variable-reference expansion)
- Inno Setup — [Pascal Scripting: Support Functions](https://jrsoftware.org/ishelp/topic_scriptfunctions.htm) (`RegQueryStringValue` returns `Boolean`)
- mdvl — `installer/lib/shells.js:204-249` (`configureWindowsPath`), `installer/lib/shells.js:290-322` (`removeWindowsPath`)

[I11]: https://github.com/flyingmt/mdvl/issues/11
[I27]: https://github.com/flyingmt/mdvl/issues/27
[I31]: https://github.com/flyingmt/mdvl/issues/31
[I32]: https://github.com/flyingmt/mdvl/issues/32
