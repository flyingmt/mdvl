const os = require("os");
const path = require("path");
const fs = require("fs");

function binaryPath(target) {
  const name = target.startsWith("windows") ? "mdvl.exe" : "mdvl";
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "mdvl", name);
  }
  return path.join(os.homedir(), ".local", "bin", name);
}

function stateDir() {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "mdvl");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "mdvl");
  }
  const xdgState =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(xdgState, "mdvl");
}

function ensureStateDir() {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function lockPath() {
  return path.join(stateDir(), "install.lock");
}

function shellFragmentPath() {
  return path.join(stateDir(), "shell.sh");
}

function fishFragmentName() {
  return "mdvl-path.fish";
}

module.exports = {
  binaryPath,
  stateDir,
  ensureStateDir,
  lockPath,
  shellFragmentPath,
  fishFragmentName,
};
