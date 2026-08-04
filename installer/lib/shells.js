const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { shellFragmentPath, fishFragmentName, stateDir } = require("./paths");

const MARKER_BEGIN = "# >>> mdvl installer >>>";
const MARKER_END = "# <<< mdvl installer <<<";

function buildSourceLine(fragmentPath) {
  return `${MARKER_BEGIN}\n[ -f "${fragmentPath}" ] && . "${fragmentPath}"\n${MARKER_END}`;
}

function isSafeToEdit(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return false;
    if (stat.isSymbolicLink()) return false;
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function addOrReplaceBlock(filePath, block) {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    content = "";
  }

  const escapedBegin = MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existingRegex = new RegExp(
    `${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`,
    "g",
  );

  content = content.replace(existingRegex, "");

  if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  content += block + "\n";

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function removeBlock(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const escapedBegin = MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existingRegex = new RegExp(
    `${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`,
    "g",
  );

  content = content.replace(existingRegex, "");
  fs.writeFileSync(filePath, content);
}

function bashProfileCandidates() {
  const home = os.homedir();
  const candidates = [];

  const bashProfile = path.join(home, ".bash_profile");
  const bashLogin = path.join(home, ".bash_login");
  const profile = path.join(home, ".profile");

  if (fs.existsSync(bashProfile)) candidates.push(bashProfile);
  else if (fs.existsSync(bashLogin)) candidates.push(bashLogin);
  else candidates.push(profile);

  candidates.push(path.join(home, ".bashrc"));
  return candidates;
}

function zshProfileCandidates() {
  const zdotdir = process.env.ZDOTDIR || os.homedir();
  return [path.join(zdotdir, ".zprofile"), path.join(zdotdir, ".zshrc")];
}

function fishConfigDir() {
  const xdgConfig =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "fish", "conf.d");
}

function detectSupportedShells() {
  const shells = [];
  const home = os.homedir();

  if (
    process.env.SHELL?.includes("bash") ||
    fs.existsSync(path.join(home, ".bashrc")) ||
    fs.existsSync(path.join(home, ".bash_profile"))
  ) {
    shells.push("bash");
  }
  if (
    process.env.SHELL?.includes("zsh") ||
    fs.existsSync(path.join(home, ".zshrc"))
  ) {
    shells.push("zsh");
  }
  const fishDir = path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "fish",
  );
  if (fs.existsSync(fishDir)) {
    shells.push("fish");
  }

  if (shells.length === 0 && process.env.SHELL) {
    return [];
  }
  return shells;
}

// One fragment is sourced from every startup file a shell reads — zsh reads
// .zprofile and then .zshrc, bash reads a profile and then .bashrc — so it runs
// at least twice per login shell, and again in every nested shell on top of an
// already-prepended PATH. An unconditional prepend therefore accumulates. The
// `case` is POSIX, so bash and zsh both take it.
function buildPathFragment(binaryDir) {
  return (
    `case ":$PATH:" in\n` +
    `  *":${binaryDir}:"*) ;;\n` +
    `  *) export PATH="${binaryDir}:$PATH" ;;\n` +
    `esac\n`
  );
}

// fish is detected from the mere existence of ~/.config/fish, which can be a
// stale directory owned by someone else — on one machine it was root-owned and
// fish was not even installed. bash and zsh already report an unwritable
// startup file as a skip; this branch used to throw, and the throw unwound an
// install whose binary and receipt were already committed. A PATH step that
// cannot write must not invalidate an install that succeeded.
function configureFishPath(binaryDir) {
  const fishDir = fishConfigDir();
  const fishFile = path.join(fishDir, fishFragmentName());
  try {
    fs.mkdirSync(fishDir, { recursive: true });
    fs.writeFileSync(fishFile, `fish_add_path -g "${binaryDir}"\n`);
    return "PATH added to fish conf.d";
  } catch (err) {
    return `skipped fish conf.d (${err.code || "not writable"})`;
  }
}

function configurePath(binaryDir) {
  const results = [];
  const fragment = shellFragmentPath();

  fs.mkdirSync(path.dirname(fragment), { recursive: true });
  fs.writeFileSync(fragment, buildPathFragment(binaryDir));

  const shells = detectSupportedShells();

  if (shells.includes("bash")) {
    const sourceLine = buildSourceLine(fragment);
    for (const file of bashProfileCandidates()) {
      if (isSafeToEdit(file)) {
        addOrReplaceBlock(file, sourceLine);
        results.push(`PATH added to ${path.basename(file)}`);
      } else if (fs.existsSync(file)) {
        results.push(`skipped ${path.basename(file)} (unsafe)`);
      }
    }
  }

  if (shells.includes("zsh")) {
    const sourceLine = buildSourceLine(fragment);
    for (const file of zshProfileCandidates()) {
      if (isSafeToEdit(file)) {
        addOrReplaceBlock(file, sourceLine);
        results.push(`PATH added to ${path.basename(file)}`);
      } else if (fs.existsSync(file)) {
        results.push(`skipped ${path.basename(file)} (unsafe)`);
      }
    }
  }

  if (shells.includes("fish")) {
    results.push(configureFishPath(binaryDir));
  }

  if (shells.length === 0) {
    results.push(
      `Shell not auto-configured. Add to PATH manually:\n    export PATH="${binaryDir}:$PATH"`,
    );
  }

  return results;
}

// A quoted PowerShell string is one parser away from the value it holds: a
// single quote or a trailing backslash in binaryDir is enough to close it
// early. Hand the value over as base64 of UTF-16LE instead — the script
// rebuilds it with no quoting rules in between.
function psStringFromBase64(value) {
  const encoded = Buffer.from(value, "utf16le").toString("base64");
  return (
    `[System.Text.Encoding]::Unicode.GetString(` +
    `[Convert]::FromBase64String('${encoded}'))`
  );
}

// mdvl 0.1.x sent the User PATH out over a cmd command line and read it back
// off stdout, and four of the six documented ways it destroyed a PATH came in
// through that channel (#29 root 2): %VAR% expansion, a trailing backslash
// collapsing the quoting, cmd metacharacters, and stdout arriving in the
// console code page. So the read, the decision and the write all happen inside
// one PowerShell child and only a short ASCII status token comes back.
// reg.exe cannot do that — its output format and encoding are unspecified, so
// the value would still have to cross stdout to be parsed here.
//
// The read must not expand: [Environment]::GetEnvironmentVariable and
// Get-ItemProperty both resolve %USERPROFILE% to one machine's absolute path
// and the write would freeze it there (rustup#261). The write must not be
// [Environment]::SetEnvironmentVariable either — it stores REG_SZ, which is
// the same freeze by another route. Hence the raw RegistryKey calls.
//
// Nothing is written that was not first read successfully. An absent value is
// not an unreadable one: a user who never had a User PATH has nothing to lose
// and gets one created, while a value of an unexpected type is left exactly as
// found (ADR-0007).
const WINDOWS_PATH_ADD = `function Invoke-MdvlPath {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($sub)
  if ($null -eq $key) { return 'SKIP:OPEN' }
  try {
    $name = $key.GetValueNames() | Where-Object { $_ -ieq 'Path' } | Select-Object -First 1
    $cur = ''
    if ($null -eq $name) {
      $name = 'Path'
    } else {
      if (@('String', 'ExpandString') -notcontains $key.GetValueKind($name).ToString()) { return 'SKIP:KIND' }
      $raw = $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
      if ($null -eq $raw) { return 'SKIP:READ' }
      $cur = [string]$raw
    }
    $mine = $dir.TrimEnd('\\')
    foreach ($entry in $cur.Split(';')) {
      if ($entry.Trim().TrimEnd('\\') -ieq $mine) { return 'PRESENT' }
    }
    if ($cur.Length -eq 0) { $new = $dir } else { $new = $dir + ';' + $cur }
    $key.SetValue($name, $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    return 'ADDED'
  } finally {
    $key.Close()
  }
}
`;

// The same rules on the way out. removeWindowsPath being accidentally safer
// than its counterpart is not something to build on: an uninstall must not be
// able to destroy what the install refused to touch. Every entry that is not
// mdvl's own is kept byte for byte — empty segments, trailing backslashes and
// %VAR% references all belong to whoever put them there.
const WINDOWS_PATH_REMOVE = `function Invoke-MdvlPath {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub, $true)
  if ($null -eq $key) { return 'ABSENT' }
  try {
    $name = $key.GetValueNames() | Where-Object { $_ -ieq 'Path' } | Select-Object -First 1
    if ($null -eq $name) { return 'ABSENT' }
    if (@('String', 'ExpandString') -notcontains $key.GetValueKind($name).ToString()) { return 'SKIP:KIND' }
    $raw = $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
    if ($null -eq $raw) { return 'SKIP:READ' }
    $cur = [string]$raw
    $mine = $dir.TrimEnd('\\')
    $kept = @()
    $found = $false
    foreach ($entry in $cur.Split(';')) {
      if ($entry.Trim().TrimEnd('\\') -ieq $mine) { $found = $true } else { $kept += $entry }
    }
    if (-not $found) { return 'ABSENT' }
    $new = $kept -join ';'
    if ($new.Length -eq 0) { $key.DeleteValue($name) } else { $key.SetValue($name, $new, [Microsoft.Win32.RegistryValueKind]::ExpandString) }
    return 'REMOVED'
  } finally {
    $key.Close()
  }
}
`;

// WM_SETTINGCHANGE tells Explorer to re-read the environment so processes
// started from now on see the new PATH. It is best-effort — the install is
// already done by the time it runs. Broadcasting it directly rather than
// through a throwaway User variable keeps this writer from touching any key
// other than the one it was handed.
const WINDOWS_PATH_EPILOGUE = `try { $status = Invoke-MdvlPath } catch { $status = 'SKIP:ERROR' }
if ($status -eq 'ADDED' -or $status -eq 'REMOVED') {
  try {
    $api = @(Add-Type -PassThru -Namespace 'Mdvl' -Name 'EnvBroadcast' -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);')[0]
    $ignored = [UIntPtr]::Zero
    $null = $api::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$ignored)
  } catch { }
}
[Console]::Out.Write($status)
`;

// hkcuSubkey is a subkey path under HKCU, never a whole hive — this seam
// exists so the destructive cases can be exercised against a scratch key, and
// it must not be able to aim at HKLM.
function buildWindowsPathScript(binaryDir, hkcuSubkey, mode) {
  const normalized = binaryDir.replace(/\//g, "\\");
  return (
    `$ErrorActionPreference = 'Stop'\n` +
    `$dir = ${psStringFromBase64(normalized)}\n` +
    `$sub = ${psStringFromBase64(hkcuSubkey)}\n` +
    (mode === "remove" ? WINDOWS_PATH_REMOVE : WINDOWS_PATH_ADD) +
    WINDOWS_PATH_EPILOGUE
  );
}

function runWindowsPathScript(script) {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function configureWindowsPath(binaryDir, hkcuSubkey = "Environment") {
  let status;
  try {
    status = runWindowsPathScript(
      buildWindowsPathScript(binaryDir, hkcuSubkey, "add"),
    );
  } catch {
    status = "SKIP:ERROR";
  }

  if (status === "ADDED") return ["PATH added to Windows User registry"];
  if (status === "PRESENT") return ["PATH already configured"];

  // A PATH step that cannot write must not invalidate an install that
  // succeeded, so this is a warning the caller prints, not a throw.
  return [
    `skipped Windows User PATH (${status}). Nothing was written — ` +
      `add this to PATH by hand:\n    ${binaryDir}`,
  ];
}

function removeUnixPath() {
  const results = [];
  const shells = detectSupportedShells();

  if (shells.includes("bash")) {
    for (const file of bashProfileCandidates()) {
      if (fs.existsSync(file)) {
        removeBlock(file);
        results.push(`removed PATH from ${path.basename(file)}`);
      }
    }
  }

  if (shells.includes("zsh")) {
    for (const file of zshProfileCandidates()) {
      if (fs.existsSync(file)) {
        removeBlock(file);
        results.push(`removed PATH from ${path.basename(file)}`);
      }
    }
  }

  if (shells.includes("fish")) {
    const fishFile = path.join(fishConfigDir(), fishFragmentName());
    if (fs.existsSync(fishFile)) {
      fs.unlinkSync(fishFile);
      results.push("removed fish conf.d fragment");
    }
  }

  const fragment = shellFragmentPath();
  if (fs.existsSync(fragment)) fs.unlinkSync(fragment);

  return results;
}

function removeWindowsPath(binaryDir, hkcuSubkey = "Environment") {
  let status;
  try {
    status = runWindowsPathScript(
      buildWindowsPathScript(binaryDir, hkcuSubkey, "remove"),
    );
  } catch {
    status = "SKIP:ERROR";
  }

  if (status === "REMOVED") return ["removed mdvl from Windows User PATH"];
  if (status === "ABSENT") return ["mdvl not found in User PATH"];

  return [
    `skipped Windows User PATH (${status}). Nothing was written — ` +
      `remove this from PATH by hand:\n    ${binaryDir}`,
  ];
}

module.exports = {
  buildPathFragment,
  buildWindowsPathScript,
  configureFishPath,
  configurePath,
  configureWindowsPath,
  removeUnixPath,
  removeWindowsPath,
  detectSupportedShells,
  MARKER_BEGIN,
  MARKER_END,
};
