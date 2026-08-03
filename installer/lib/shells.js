const fs = require("fs");
const path = require("path");
const os = require("os");
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

function configureWindowsPath(binaryDir) {
  const { execSync } = require("child_process");

  let currentUserPath;
  try {
    const output = execSync(`reg query "HKCU\\Environment" /v Path`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const match = output.match(/Path\s+REG(?:_EXPAND_)?SZ\s+(.*)/);
    currentUserPath = match ? match[1].trim() : "";
  } catch {
    currentUserPath = "";
  }

  const normalized = binaryDir.replace(/\//g, "\\");
  const entries = currentUserPath
    ? currentUserPath.split(";").filter(Boolean)
    : [];

  if (entries.some((e) => e.toLowerCase() === normalized.toLowerCase())) {
    return ["PATH already configured"];
  }

  const newPath = normalized + ";" + currentUserPath;
  if (newPath.length > 2048) {
    throw new Error(
      `Adding mdvl to User PATH would exceed the 2048-character safety limit. ` +
        `Current length: ${currentUserPath.length}. Add manually if needed.`,
    );
  }

  const regType = currentUserPath.includes("%") ? "REG_EXPAND_SZ" : "REG_SZ";
  execSync(
    `reg add "HKCU\\Environment" /v Path /t ${regType} /d "${newPath}" /f`,
    { stdio: "pipe" },
  );

  try {
    execSync(
      "powershell -NoProfile -Command \"[System.Environment]::SetEnvironmentVariable('dummy', $null, 'User')\"",
      { stdio: "pipe" },
    );
  } catch {
    // WM_SETTINGCHANGE best-effort
  }

  return ["PATH added to Windows User registry"];
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

function removeWindowsPath(binaryDir) {
  const { execSync } = require("child_process");
  const normalized = binaryDir.replace(/\//g, "\\");

  let currentUserPath;
  try {
    const output = execSync(`reg query "HKCU\\Environment" /v Path`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const match = output.match(/Path\s+REG(?:_EXPAND_)?SZ\s+(.*)/);
    currentUserPath = match ? match[1].trim() : "";
  } catch {
    return ["no User PATH to clean"];
  }

  const entries = currentUserPath ? currentUserPath.split(";") : [];
  const filtered = entries.filter(
    (e) => e.trim().toLowerCase() !== normalized.toLowerCase(),
  );
  const newPath = filtered.join(";");

  if (newPath !== currentUserPath) {
    const regType = currentUserPath.includes("%") ? "REG_EXPAND_SZ" : "REG_SZ";
    execSync(
      `reg add "HKCU\\Environment" /v Path /t ${regType} /d "${newPath}" /f`,
      { stdio: "pipe" },
    );
    return ["removed mdvl from Windows User PATH"];
  }

  return ["mdvl not found in User PATH"];
}

module.exports = {
  buildPathFragment,
  configureFishPath,
  configurePath,
  configureWindowsPath,
  removeUnixPath,
  removeWindowsPath,
  detectSupportedShells,
  MARKER_BEGIN,
  MARKER_END,
};
