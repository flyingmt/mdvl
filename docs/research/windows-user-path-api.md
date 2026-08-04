# Non-destructive read-modify-write of the Windows User PATH

Research date: 2026-08-04

Scope: how to read and modify `HKEY_CURRENT_USER\Environment\Path` for a
current-user, no-administrator install without destroying data that the value
already holds. This report answers [research issue #30](https://github.com/flyingmt/mdvl/issues/30),
which is part of the [Binary Installer map (#27)](https://github.com/flyingmt/mdvl/issues/27)
and resolves question 6 left open by
[`docs/research/user-path-conventions.md`](user-path-conventions.md). It states
facts and their sources; it does not choose the installer's implementation.

## Evidence labels

- **Documented** — stated by the owner's reference documentation (Microsoft
  Learn, Node.js API docs).
- **Source-verified** — not stated in the documentation; established by reading
  the shipping implementation in the owner's repository. Cited with a permalink.
- **Undocumented** — the owner's documentation is silent. Named as such rather
  than guessed.

## Short answer

1. Read the value **unexpanded** and read its **type** in the same operation
   (`RegQueryValueEx`, or `RegGetValue` with `RRF_NOEXPAND`, or .NET
   `RegistryKey.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames)`).
2. Modify the string without normalizing anything you did not add.
3. Write it back with the **original** value type (`RegSetValueEx` with the
   `dwType` you read).
4. Broadcast `WM_SETTINGCHANGE` with `lParam = "Environment"` via
   `SendMessageTimeout(HWND_BROADCAST, …, SMTO_ABORTIFHUNG, <small timeout>)`.
5. Do **not** use `setx`. Do **not** use
   `[Environment]::SetEnvironmentVariable(…, 'User')`. Both are documented or
   source-verified to destroy `REG_EXPAND_SZ` semantics.
6. If a child process must be spawned at all, spawn `reg.exe` directly
   (`execFileSync`, no shell) and decode its bytes explicitly — never through
   `cmd.exe` with `%VAR%` in the command line, and never with
   `encoding: 'utf8'` assumed.

## The three candidate mechanisms and how each corrupts the value

### A. `reg query` / `reg add` through `cmd.exe`

**Documented capability.** `reg add <keyname> [/v valuename | /ve] [/t datatype]
[/s separator] [/d data] [/f]`; `/t` accepts `REG_EXPAND_SZ`; `/f` "Adds the
registry entry without prompting for confirmation."
[reg add](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add)

Corrupting failure modes:

- **cmd expands `%…%` before `reg.exe` ever runs.** "To substitute variable
  values in the command line or scripts, enclose the variable name in percent
  signs (`%VariableName%`). … When a script is run, `cmd` replaces instances of
  the variable with its value."
  [cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd#substituting-environment-variable-values)
  Microsoft's own `reg add` example works around this by escaping:
  `reg add HKLM\Software\MyCo /v Path /t REG_EXPAND_SZ /d ^%systemroot^%`, and
  the remarks state "For the **REG_EXPAND_SZ** key type, use the caret symbol
  ( **^** ) with **%** inside the /d parameter."
  [reg add](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add)
  A read-modify-write that pipes an existing `REG_EXPAND_SZ` value back through
  a cmd command line therefore silently freezes every `%VAR%` reference in it.
- **Command-line length.** "The maximum length of the string that you can use at
  the command prompt is 8191 characters. This limitation applies to: the command
  line; individual environment variables that are inherited by other processes,
  such as the PATH variable; all environment variable expansions." The same page
  adds: "Even though the Win32 limitation for environment variables is 32,767
  characters, Command Prompt ignores any environment variables that are
  inherited from the parent process and are longer than its own limitations of
  8191 characters."
  [Command prompt line string limitation](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation)
  A long PATH cannot be round-tripped through a command line at all.
- **Quoting.** "The ampersand `&`, pipe `|`, and parentheses `( )` are special
  characters that must be preceded by the escape character `^` or quotation
  marks when you pass them as arguments" and "You must use quotation marks around
  the following special characters: & < > [ ] | { } ^ = ; ! ' + , ` ~
  [white space]". Note `;` — the PATH separator itself — is on that list.
  [cmd Remarks](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd#remarks)
- **`reg add` is unconditional overwrite, not merge.** `/f` suppresses the
  confirmation prompt; the documentation describes no read-modify-write support
  and no way to learn the previous value in the same operation.
  [reg add](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add)
- **`reg query` output is unspecified.** The reference documents parameters and
  examples only. It never states the output encoding, the field delimiter,
  whether a `REG_EXPAND_SZ` value is printed expanded or raw, or how a value
  containing the delimiter is escaped. **Undocumented** — parsing it is
  unspecified behavior.
  [reg query](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-query)
- **`reg add` has no documented `/d` length limit** of its own. **Undocumented**;
  in practice the binding limits are the command line (above) and the registry
  limits (below).

### B. PowerShell / .NET `[System.Environment]::SetEnvironmentVariable(name, value, 'User')`

**Documented behavior.**
[Environment.SetEnvironmentVariable](https://learn.microsoft.com/en-us/dotnet/api/system.environment.setenvironmentvariable?view=net-10.0)

> "If `target` is `EnvironmentVariableTarget.User`, the environment variable is
> stored in the HKEY_CURRENT_USER\Environment key of the local computer's
> registry. It is also copied to instances of File Explorer that are running as
> the current user. The environment variable is then inherited by any new
> processes that the user launches from File Explorer."

> "If `target` is `User` or `Machine`, other applications are notified of the set
> operation by a Windows `WM_SETTINGCHANGE` message."

> "If `target` is `EnvironmentVariableTarget.User` or
> `EnvironmentVariableTarget.Machine`, we recommend that the length of `value` be
> less than 2048 characters."

> "If `value` is `null` (or empty in versions prior to .NET 9) and the
> environment variable named by `variable` exists, the environment variable is
> deleted."

Documented `ArgumentException` conditions include "`target` is `Machine` or
`User`, and the length of `variable` is greater than or equal to 255" and "The
length of `variable` is greater than or equal to 32,767 characters". On
Unix-like systems, `User`/`Machine` calls "are ignored".

**Is it true that it downgrades the type to `REG_SZ`? Yes.**

The .NET documentation is **silent** on the registry value type — the
`SetEnvironmentVariable` page contains no occurrence of `REG_SZ`,
`REG_EXPAND_SZ`, or any registry type. The answer comes from the shipping
implementation:

- `Environment.Windows.cs`, `SetEnvironmentVariableFromRegistry`, calls
  `environmentKey.SetValue(variable, value)` — the two-argument overload, with no
  `RegistryValueKind`.
  [dotnet/runtime `Environment.Windows.cs`](https://github.com/dotnet/runtime/blob/6e51f762bc4c98ea90ae6ca21c4e220b4b2e7a5c/src/libraries/System.Private.CoreLib/src/System/Environment.Windows.cs)
- `RegistryKey.SetValue(name, value)` forwards to
  `SetValue(name, value, RegistryValueKind.Unknown)`; `Unknown` means "determine
  the appropriate registry data type", and for a plain `string` the calculated
  kind is `RegistryValueKind.String`, which is then passed to
  `Interop.Advapi32.RegSetValueEx`.
  [dotnet/runtime `RegistryKey.cs`](https://github.com/dotnet/runtime/blob/6e51f762bc4c98ea90ae6ca21c4e220b4b2e7a5c/src/libraries/Microsoft.Win32.Registry/src/Microsoft/Win32/RegistryKey.cs)
  `RegistryValueKind.String` is documented as "equivalent to the Windows API
  registry data type REG_SZ".
  [RegistryValueKind](https://learn.microsoft.com/en-us/dotnet/api/microsoft.win32.registryvaluekind?view=net-10.0)
- .NET Framework does the same thing: `environmentKey.SetValue(variable, value)`.
  [referencesource `mscorlib/system/environment.cs`](https://github.com/microsoft/referencesource/blob/1acafe20a789a55daa17aac6bb47d1b0ec04519f/mscorlib/system/environment.cs)

So the API always writes `REG_SZ`, whatever the value's previous type was.
Windows PowerShell 5.1 and PowerShell 7 both inherit this, since both call the
same .NET method.

**The read side compounds it.** `Environment.GetEnvironmentVariable(name, 'User')`
calls `RegistryKey.GetValue(name)` with `doNotExpand: false`, and
`RegistryKey.InternalGetValue` runs `Environment.ExpandEnvironmentVariables` on
the string when the stored type is `REG_EXPAND_SZ`
([`Environment.Windows.cs`](https://github.com/dotnet/runtime/blob/6e51f762bc4c98ea90ae6ca21c4e220b4b2e7a5c/src/libraries/System.Private.CoreLib/src/System/Environment.Windows.cs),
[`RegistryKey.cs`](https://github.com/dotnet/runtime/blob/6e51f762bc4c98ea90ae6ca21c4e220b4b2e7a5c/src/libraries/Microsoft.Win32.Registry/src/Microsoft/Win32/RegistryKey.cs)).
The documentation is **silent** about this expansion.

Therefore the obvious idiom

```powershell
$p = [Environment]::GetEnvironmentVariable('Path','User')
[Environment]::SetEnvironmentVariable('Path', "$p;$new", 'User')
```

corrupts the value twice: it expands every `%VAR%` reference to today's literal
value, then stores the result as `REG_SZ` so it can never expand again. A user
whose PATH contained `%JAVA_HOME%\bin` loses the indirection permanently.

Real-world confirmation of the failure class: rustup shipped this bug and fixed
it — [rust-lang/rustup#261 "\[win\] rustup setting wrong registry type for PATH"](https://github.com/rust-lang/rustup/issues/261)
("winreg always uses `REG_SZ` type while environment often contains
`REG_EXPAND_SZ` … after installing rustup, `PATH` environment is broken and
cannot be expanded properly"). Current rustup writes
`environment.set_expand_hstring("PATH", &new_path)` and has a regression test
asserting `path.ty() == Type::ExpandString`.
[rustup `src/cli/self_update/windows.rs`](https://github.com/rust-lang/rustup/blob/master/src/cli/self_update/windows.rs)

**Broadcast parameters used by .NET** (source-verified, undocumented):
`SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment", 0, 1000, …)`
— note flags `0`, *not* `SMTO_ABORTIFHUNG`, and a 1000 ms timeout.
[`Environment.Windows.cs`](https://github.com/dotnet/runtime/blob/6e51f762bc4c98ea90ae6ca21c4e220b4b2e7a5c/src/libraries/System.Private.CoreLib/src/System/Environment.Windows.cs)

### C. `Get-ItemProperty` / `Set-ItemProperty` on `HKCU:\Environment`

- **`Get-ItemProperty` expands.** The PowerShell documentation is **silent** on
  expansion. The registry provider builds its result with
  `key.GetValue(valueName)` — the overload without
  `RegistryValueOptions.DoNotExpandEnvironmentNames` — so a `REG_EXPAND_SZ`
  value comes back already expanded.
  [PowerShell `RegistryProvider.cs`](https://github.com/PowerShell/PowerShell/blob/master/src/System.Management.Automation/namespaces/RegistryProvider.cs)
  (The provider does use `DoNotExpandEnvironmentNames` in one place —
  `ReadExistingKeyValue`, the echo-back after a write — which is not the
  `Get-ItemProperty` path.)
- **`Set-ItemProperty` documentation and implementation disagree.**
  `about_Registry_Provider` says of the `Type` dynamic parameter: "Establishes or
  changes the data type of a registry value. **The default is `String` (REG_SZ)**."
  [about_Registry_Provider](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_registry_provider?view=powershell-7.5#type-microsoftwin32registryvaluekind)
  The implementation instead looks up the existing kind first: in
  `SetRegistryValue`, "If user does not specify a kind: get the valuekind if the
  property already exists" → `existingKind = GetValueKindForProperty(...)`, and
  when that succeeds it converts the value to `existingKind` and uses it; only if
  the value does not exist or the conversion throws does it fall back to
  inferring `String`.
  [PowerShell `RegistryProvider.cs`](https://github.com/PowerShell/PowerShell/blob/master/src/System.Management.Automation/namespaces/RegistryProvider.cs)
  So on an existing `REG_EXPAND_SZ` PATH it preserves the type — but that
  behavior is contradicted by the published documentation and must not be relied
  on. Pass `-Type ExpandString` explicitly.
- **No broadcast.** Neither `Set-ItemProperty` nor the registry provider
  documentation mentions `WM_SETTINGCHANGE`; the write is a plain registry write.
  The caller must broadcast (see below).
- Accepted `Type` values are documented, including "`ExpandString`: Specifies a
  null-terminated string that contains unexpanded references to environment
  variables that are expanded when the value is retrieved. Used for
  **REG_EXPAND_SZ** values."
  [Set-ItemProperty -Type](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-itemproperty?view=powershell-7.5#-type)

## Preserving `REG_EXPAND_SZ`

`REG_EXPAND_SZ` is documented as "A null-terminated string that contains
unexpanded references to environment variables, for example, *%PATH%*. … To
expand the environment variable references, use the **ExpandEnvironmentStrings**
function." `REG_SZ` is "A null-terminated string" with no expansion contract.
[Registry value types](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-value-types)

To preserve it you must set the type explicitly on every write:

| Mechanism | How to preserve |
| --- | --- |
| `RegSetValueEx` | pass the `dwType` you read back from `RegQueryValueEx` ([RegSetValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regsetvalueexw)) |
| .NET registry API | `RegistryKey.SetValue(name, value, RegistryValueKind.ExpandString)` ([RegistryKey.SetValue](https://learn.microsoft.com/en-us/dotnet/api/microsoft.win32.registrykey.setvalue?view=net-10.0)) |
| PowerShell provider | `Set-ItemProperty -Type ExpandString` ([-Type](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-itemproperty?view=powershell-7.5#-type)) |
| `reg add` | `/t REG_EXPAND_SZ` plus `^%…^%` escaping ([reg add](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add)) |
| `[Environment]::SetEnvironmentVariable` | **impossible** — always `REG_SZ` (source-verified above) |
| `setx` | **impossible** — expands references (documented below) |

When creating the value from scratch, `REG_EXPAND_SZ` is the safe default: it is
what Windows itself uses for `Path`, and a value with no `%` in it behaves
identically under either type.

## Length limits: what `setx`'s 1024 applies to, and what the real limits are

- **`setx`, 1024 characters, documented, destructive:** "Be aware there's a limit
  of 1024 characters when assigning contents to a variable using **setx**. This
  means that the content is cropped if you go over 1024 characters, and that the
  cropped text is what's applied to the target variable. If this cropped text is
  applied to an existing variable, it can result in loss of data previously held
  by the target variable."
  [setx](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setx#remarks)
  This limit is scoped to `setx` itself and appears on no other Microsoft page.
- **`setx` also destroys `REG_EXPAND_SZ` semantics regardless of length:**
  "Running this command on an existing variable removes any variable references
  and uses expanded values. For instance, if the variable %PATH% has a reference
  to %JAVADIR%, and %PATH% is manipulated using **setx**, %JAVADIR% is expanded
  and its value is assigned directly to the target variable %PATH%. This means
  that future updates to %JAVADIR% **will not** be reflected in the %PATH%
  variable." It also "writes variables to the master environment in the registry.
  Variables set with **setx** variables are available in future command windows
  only, not in the current command window."
  [setx](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setx#remarks)
- **Registry API / `RegSetValueEx`:** "Value sizes are limited by available
  memory. However, storing large values in the registry can affect its
  performance. Long values (more than 2,048 bytes) should be stored as files".
  [RegSetValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regsetvalueexw#remarks)
- **Registry element limits:** value name 16,383 characters; value "Available
  memory (latest format) 1 MB (standard format)".
  [Registry element size limits](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-element-size-limits)
- **Win32 environment variable:** "The maximum size of a user-defined environment
  variable is 32,767 characters."
  [Environment Variables](https://learn.microsoft.com/en-us/windows/win32/procthread/environment-variables)
- **cmd:** command line 8,191 characters
  ([troubleshooting article](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation));
  the cmd reference separately says "The maximum individual environment variable
  size is 8,192 bytes" and "The maximum total size for all environment variables
  … is 65,536 characters for a process"
  ([cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd#setting-environment-variables)).
  These two Microsoft pages disagree; treat 8,191 as the conservative cmd bound.
- **.NET:** "we recommend that the length of `value` be less than 2048
  characters" for `User`/`Machine`; the documented hard `ArgumentException` at
  32,767 characters applies to `value` only for the `Process` target, and a 255
  limit applies to the *name* for `User`/`Machine`.
  [Environment.SetEnvironmentVariable](https://learn.microsoft.com/en-us/dotnet/api/system.environment.setenvironmentvariable?view=net-10.0)
  Source-verified: the managed code enforces only the 255-character *name* check
  for the User target; it applies no length check to the value.

Net: no documented 1024 limit exists outside `setx`. A registry-API writer is
bounded by 32,767 characters (the environment-variable limit that consumers
enforce), not by 1024; a cmd-mediated writer is additionally bounded by 8,191.

## Reading the raw, unexpanded value

- **Win32, `RegQueryValueEx`:** returns "the type and data for the specified
  value name" and performs no expansion. Caveat: "If the value being queried is a
  string (REG_SZ, REG_MULTI_SZ, and REG_EXPAND_SZ) the value returned is NOT
  guaranteed to be null-terminated."
  [RegQueryValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regqueryvalueexw)
- **Win32, `RegGetValue`:** expands by default; suppress with
  `RRF_NOEXPAND` (0x10000000) — "Do not automatically expand environment strings
  if the value is of type REG_EXPAND_SZ."
  [RegGetValueW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-reggetvaluew)
  Same rule for the shell helper: "Unless the SRRF_NOEXPAND flag is set, string
  data of type REG_EXPAND_SZ is automatically expanded before being returned.
  The expanded string's type is reported in *pdwType* as REG_SZ".
  [SHRegGetValueA](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-shreggetvaluea#remarks)
- **.NET:** `RegistryValueOptions.DoNotExpandEnvironmentNames` (value 1) — "A
  value of type `ExpandString` is retrieved without expanding its embedded
  environment variables", used with the
  `GetValue(String, Object, RegistryValueOptions)` overload.
  [RegistryValueOptions](https://learn.microsoft.com/en-us/dotnet/api/microsoft.win32.registryvalueoptions?view=net-10.0)
  ·
  [RegistryKey.GetValue](https://learn.microsoft.com/en-us/dotnet/api/microsoft.win32.registrykey.getvalue?view=net-10.0)
- **PowerShell:** go through the .NET key object, not `Get-ItemProperty`:
  `(Get-Item HKCU:\Environment).GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`.
- Read the type in the same pass — `RegQueryValueEx`'s `lpType`, or
  `RegistryKey.GetValueKind` — so the write-back can restore it.
- Access: the key must be opened with `KEY_QUERY_VALUE` to read and
  `KEY_SET_VALUE` to write.
  [RegSetValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regsetvalueexw#parameters)

## Broadcasting `WM_SETTINGCHANGE`

Documented procedure:

> "To programmatically add or modify system environment variables, add them to
> the **HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\Session Manager\Environment**
> registry key, then broadcast a **WM_SETTINGCHANGE** message with *lParam* set
> to the string "Environment". This allows applications, such as the shell, to
> pick up your updates."
> — [Environment Variables](https://learn.microsoft.com/en-us/windows/win32/procthread/environment-variables)

> "Applications should send **WM_SETTINGCHANGE** to all top-level windows when
> they make changes to system parameters. (This message cannot be sent directly
> to a window.) To send the **WM_SETTINGCHANGE** message to all top-level
> windows, use the **SendMessageTimeout** function with the *hwnd* parameter set
> to **HWND_BROADCAST**."
> "To effect a change in the environment variables for the system or the user,
> broadcast this message with *lParam* set to the string "Environment"."
> "When an application sends this message, this parameter [*wParam*] must be **NULL**."
> — [WM_SETTINGCHANGE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settingchange)

Constraints on the call:

- `HWND_BROADCAST` "sends the message to all top-level windows in the system,
  including disabled or invisible unowned windows. The function does not return
  until each window has timed out. Therefore, the total wait time can be up to
  the value of *uTimeout* multiplied by the number of top-level windows." Use a
  small `uTimeout` and `SMTO_ABORTIFHUNG` ("The function returns without waiting
  for the time-out period to elapse if the receiving thread appears to not
  respond or 'hangs.'").
  [SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)
- Return handling: "If the function fails or times out, the return value is 0.
  Note that the function does not always call SetLastError on failure. If the
  reason for failure is important to you, call SetLastError(ERROR_SUCCESS)
  before calling SendMessageTimeout."
  [SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw#return-value)
- Asynchronous alternatives do not work here: for messages below `WM_USER`,
  "its message parameters cannot include pointers … The functions will return
  before the receiving thread has had a chance to process the message and the
  sender will free the memory before it is used."
  [SendNotifyMessageW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendnotifymessagew#remarks)
  Since `lParam` is a pointer to `"Environment"`, `SendMessageTimeout` is the
  correct call, not `PostMessage`/`SendNotifyMessage`.
- Working reference implementations: rustup uses
  `SendMessageTimeoutA(HWND_BROADCAST, WM_SETTINGCHANGE, 0, c"Environment", SMTO_ABORTIFHUNG, 5000, null)`
  ([rustup](https://github.com/rust-lang/rustup/blob/master/src/cli/self_update/windows.rs));
  .NET uses flags `0` with a 1000 ms timeout
  ([dotnet/runtime](https://github.com/dotnet/runtime/blob/6e51f762bc4c98ea90ae6ca21c4e220b4b2e7a5c/src/libraries/System.Private.CoreLib/src/System/Environment.Windows.cs)).
- **What the broadcast does not guarantee:** no Microsoft page states that an
  already-running console or terminal host will pick up the new PATH. The
  documented guarantees are that listeners are *notified*, that File Explorer
  instances are updated, and that processes newly launched from Explorer inherit
  the change. "Each instance of `cmd` inherits the environment of its parent
  application."
  [cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd#using-environment-variables)
  The installer must tell the user to open a new terminal.

## Console code page and captured stdout

Documented mechanics:

- "A console uses its output code page to translate the character values written
  by the various output functions into the images displayed in the console
  window."
  [GetConsoleOutputCP](https://learn.microsoft.com/en-us/windows/console/getconsoleoutputcp)
  ·
  [SetConsoleOutputCP](https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp)
- `chcp` "Changes the active console code page", and "Programs that you start
  after you assign a new code page use the new code page. However, programs
  (except Cmd.exe) that you started before assigning the new code page will
  continue to use the original code page."
  [chcp](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/chcp#remarks)
- Code pages for Korean/Japanese/Chinese are DBCS: "some characters have two-byte
  encodings with certain byte values (always values greater than 127) serving as
  'lead bytes'", and "Data converted from one SBCS or DBCS code page to another
  is subject to corruption, because the same data value on different code pages
  can encode a different character."
  [Code Pages](https://learn.microsoft.com/en-us/windows/win32/intl/code-pages)
- cmd can be told which encoding to emit into a pipe or file: `/a` "Formats
  command output as American National Standards Institute (ANSI)", `/u` "Formats
  command output as Unicode".
  [cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)
- A process can be forced to UTF-8 via the `activeCodePage` manifest property
  (Windows 1903+) or the system-wide "Beta: Use Unicode UTF-8 for worldwide
  language support" setting.
  [Use UTF-8 code pages in Windows apps](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page)

Node.js side:

- `execSync`, `execFileSync`, and `spawnSync`: "`encoding` {string} The encoding
  used for all stdio inputs and outputs. **Default:** `'buffer'`." `exec` and
  `execFile` default to `'utf8'`.
  [Node.js child_process](https://nodejs.org/api/child_process.html)
- Node's documentation says **nothing** about Windows code pages. Passing
  `encoding: 'utf8'` (or using `exec`) makes Node decode the child's bytes as
  UTF-8 unconditionally. On a Korean Windows install whose console code page is
  949, a PATH containing `C:\Users\홍길동\…` comes back as replacement characters
  or mojibake — and if that mangled string is then written back, the PATH is
  destroyed. **This is a Node-side assumption, not a Windows behavior.**
- **Undocumented:** Microsoft does not specify what encoding `reg.exe` writes when
  its stdout is a pipe rather than a console. Do not assume; verify on the target
  system, or avoid the question entirely.

Avoidance, in order of preference:

1. Do not spawn a child process — call the registry API and get UTF-16 strings
   with no code-page conversion anywhere.
2. If a child is unavoidable, keep `execSync`'s default `encoding: 'buffer'` and
   decode the bytes explicitly with a known code page, having first forced that
   code page (`chcp 65001`, `cmd /u`, or the `activeCodePage` manifest).
3. In PowerShell, the relevant knob for *reading* native-command output is
   `[Console]::OutputEncoding`. The PowerShell documentation does not cover this;
   it documents only that "The automatic variable `$OutputEncoding` affects the
   encoding PowerShell uses to communicate with external programs" without
   specifying direction.
   [about_Character_Encoding](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.5)
   **Undocumented** for the read direction.

## `cmd.exe` `%VAR%` expansion through `child_process.execSync`

- `execSync` always runs through a shell: `shell` "Shell to execute the command
  with. **Default:** `'/bin/sh'` on Unix, `process.env.ComSpec` on Windows", and
  "The shell should understand the `-c` switch. If the shell is `'cmd.exe'`, it
  should understand the `/d /s /c` switches and command-line parsing should be
  compatible."
  [Node.js child_process](https://nodejs.org/api/child_process.html)
- cmd substitutes `%VariableName%` in the command line before the target program
  runs
  ([cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd#substituting-environment-variable-values)),
  and "Variable substitution isn't recursive; `cmd` checks variables only once."
- Consequence: `execSync('reg add … /d "%PATH%;C:\\new"')` stores today's
  *expanded* PATH; a `REG_EXPAND_SZ` value read out and passed back through a cmd
  command line loses every `%VAR%` reference in exactly the same way `setx` does.
  Escaping with `^%` is required and is documented only by example in
  [reg add](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add).
- Fix: use `execFileSync('reg', [...])` — `execFile` "does not spawn a shell by
  default", `spawn`'s `shell` defaults to `false`
  ([Node.js child_process](https://nodejs.org/api/child_process.html)) — so
  arguments reach `reg.exe` verbatim with no `%` substitution and no cmd quoting
  rules. `reg.exe` is a real executable, so the `.bat`/`.cmd` restriction that
  forces a shell does not apply.
- Note `ExpandEnvironmentStrings` semantics if you ever expand deliberately:
  "Case is ignored when looking up the environment-variable name. If the name is
  not found, the %*variableName*% portion is left unexpanded", and it "does not
  support all the features that Cmd.exe supports".
  [ExpandEnvironmentStringsW](https://learn.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-expandenvironmentstringsw)

## Procedure that follows from the above

1. Open `HKEY_CURRENT_USER\Environment` with `KEY_QUERY_VALUE | KEY_SET_VALUE`.
   A failure here is a legitimate no-admin outcome; report it, do not elevate.
2. Read `Path` **unexpanded**, together with its type. A missing value is not an
   error — treat it as empty and create `REG_EXPAND_SZ`.
3. If the type is neither `REG_SZ` nor `REG_EXPAND_SZ`, refuse and tell the user.
   (rustup takes exactly this stance: "If this returns None then the PATH
   variable is not a string and we should not mess with it."
   [rustup](https://github.com/rust-lang/rustup/blob/master/src/cli/self_update/windows.rs))
4. Split on `;`. Do not trim, case-fold, deduplicate, or reorder entries you did
   not add — `REG_EXPAND_SZ` references, 8.3 aliases, and empty segments are all
   semantically load-bearing (see
   [`user-path-conventions.md`](user-path-conventions.md)).
5. If the target directory is already present, write nothing and exit success.
6. Write back with `RegSetValueEx` using the **type you read**.
7. Broadcast `WM_SETTINGCHANGE` with `lParam = "Environment"`,
   `SMTO_ABORTIFHUNG`, small timeout; treat broadcast failure as non-fatal.
8. Instruct the user to open a new terminal.
9. Uninstall is the same procedure in reverse, removing only the entry the
   installer added, and deleting the value only if it becomes empty.

## Documentation gaps found

- The .NET `SetEnvironmentVariable` documentation never states the registry value
  type it writes; the answer required reading dotnet/runtime.
- `about_Registry_Provider` says `Set-ItemProperty` defaults to `String`
  (`REG_SZ`); the implementation preserves the existing kind. Documentation and
  behavior disagree.
- `Environment.GetEnvironmentVariable(name, 'User')` expands `%VAR%` references;
  the documentation does not say so.
- `reg query` output format, encoding, and expansion behavior are unspecified;
  `reg add` publishes no `/d` length limit.
- Microsoft publishes four different environment-variable size limits (32,767 /
  8,191 / 8,192 bytes with 65,536 total / `setx` 1,024) plus a .NET
  recommendation of 2,048, without reconciling them.
- No Microsoft page states that an already-running console picks up a broadcast
  environment change.
- Node.js documents no Windows code-page behavior for captured child stdout, and
  Microsoft does not document what encoding `reg.exe` writes to a pipe.
