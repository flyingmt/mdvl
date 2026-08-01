#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const platform = require("../lib/platform");
const checksum = require("../lib/checksum");
const receipt = require("../lib/receipt");
const paths = require("../lib/paths");
const lock = require("../lib/lock");
const shells = require("../lib/shells");

function logStep(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function logHead(msg) {
  console.log(msg);
}

function logDone() {
  console.log("Done.");
}

function logError(msg) {
  console.error(`Error: ${msg}`);
  console.error("Exit 1.");
}

function preflight() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 22) {
    throw new Error(
      `mdvl installer requires Node 22+ (current: ${process.version}). ` +
        `Install a maintained Node.js release and re-run.`,
    );
  }
  const npmMajor = parseInt(process.env.npm_version?.split(".")[0] || "0", 10);
  if (npmMajor > 0 && npmMajor < 10) {
    throw new Error(
      `mdvl installer requires npm 10+ (current: ${process.env.npm_version}). ` +
        `Update npm and re-run.`,
    );
  }
}

function loadChecksums() {
  const p = path.join(__dirname, "..", "checksums.json");
  if (!fs.existsSync(p)) {
    throw new Error("checksums.json not found in the installer package.");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function getPackageVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  return pkg.version;
}

async function install() {
  const target = platform.detect();
  const version = getPackageVersion();
  const checksums = loadChecksums();
  const expectedSha256 = checksums[target];
  if (!expectedSha256) {
    throw new Error(
      `No checksum for target ${target}. This release may be incomplete.`,
    );
  }

  const sourceBinary = platform.resolveChildBinary(target);
  const destBinary = paths.binaryPath(target);
  const sDir = paths.stateDir();

  const existing = receipt.read(sDir);
  if (existing && existing.version === version && fs.existsSync(destBinary)) {
    logHead(`mdvl ${version} — already installed`);
    logDone();
    return;
  }

  if (!existing && fs.existsSync(destBinary)) {
    throw new Error(
      `found mdvl at ${destBinary} but it was not installed by this installer.\n` +
        `  To proceed, remove it manually first:\n` +
        `    rm ${destBinary}\n` +
        `  Then re-run this command.\n` +
        `refusing to overwrite unmanaged binary`,
    );
  }

  const verb = existing
    ? `updating from ${existing.version}`
    : `installing for ${target}`;
  logHead(`mdvl ${version} — ${verb}...`);

  let lockFile;
  try {
    lockFile = lock.acquire();
  } catch (err) {
    throw new Error(err.message);
  }

  try {
    const tmpPath = destBinary + ".tmp";
    fs.mkdirSync(path.dirname(destBinary), { recursive: true });
    fs.copyFileSync(sourceBinary, tmpPath);
    if (process.platform !== "win32") {
      fs.chmodSync(tmpPath, 0o755);
    }

    logStep("✓", "binary verified (sha256)");
    await checksum.verify(tmpPath, expectedSha256);

    fs.renameSync(tmpPath, destBinary);
    logStep("✓", `installed to ${destBinary}`);

    receipt.write(sDir, receipt.create(version, target, expectedSha256));

    const binaryDir = path.dirname(destBinary);
    let pathResults;
    if (process.platform === "win32") {
      pathResults = shells.configureWindowsPath(binaryDir);
    } else {
      pathResults = shells.configurePath(binaryDir);
    }

    for (const r of pathResults) {
      if (r.startsWith("PATH added") || r.includes("already")) {
        logStep("✓", r);
      } else {
        logStep("⚠", r);
      }
    }

    if (process.platform !== "win32") {
      const currentShell = process.env.SHELL || "";
      if (currentShell && !pathResults.some((r) => r.includes("already"))) {
        const shellName = path.basename(currentShell);
        logStep(
          "⚠",
          `Open a new terminal or run: source ~/.${shellName.includes("zsh") ? "zshrc" : "bashrc"}`,
        );
      }
    }

    logDone();
    console.log(`Run 'mdvl --version' to verify.`);
  } finally {
    lock.release(lockFile);
  }
}

async function uninstall() {
  const sDir = paths.stateDir();
  const existing = receipt.read(sDir);

  if (!existing) {
    throw new Error(
      "mdvl is not installed (no receipt found). Nothing to uninstall.",
    );
  }

  const target = existing.target;
  const destBinary = paths.binaryPath(target);

  logHead(`mdvl — uninstalling ${existing.version}...`);

  let lockFile;
  try {
    lockFile = lock.acquire();
  } catch (err) {
    throw new Error(err.message);
  }

  try {
    if (fs.existsSync(destBinary)) {
      fs.unlinkSync(destBinary);
      logStep("✓", `removed ${destBinary}`);
    }

    receipt.remove(sDir);
    logStep("✓", "removed receipt");

    if (process.platform === "win32") {
      const results = shells.removeWindowsPath(path.dirname(destBinary));
      for (const r of results) logStep("✓", r);
    } else {
      const results = shells.removeUnixPath();
      for (const r of results) logStep("✓", r);
    }

    lock.release(lockFile);
    const lockP = paths.lockPath();
    if (fs.existsSync(lockP)) fs.unlinkSync(lockP);

    try {
      if (fs.existsSync(sDir) && fs.readdirSync(sDir).length === 0) {
        fs.rmdirSync(sDir);
        logStep("✓", "cleaned up state directory");
      }
    } catch {
      // best-effort
    }

    logDone();
  } catch (err) {
    lock.release(lockFile);
    throw err;
  }
}

async function main() {
  try {
    preflight();

    const subcommand = process.argv[2];
    if (subcommand === "uninstall") {
      await uninstall();
    } else {
      await install();
    }
    process.exit(0);
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

main();
