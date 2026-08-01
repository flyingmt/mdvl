const fs = require("fs");
const path = require("path");
const { lockPath, ensureStateDir } = require("./paths");

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquire() {
  ensureStateDir();
  const lp = lockPath();
  if (fs.existsSync(lp)) {
    const pid = parseInt(fs.readFileSync(lp, "utf8").trim(), 10);
    if (!Number.isNaN(pid) && pidAlive(pid)) {
      throw new Error(
        `Another mdvl installer is running (PID ${pid}). Close it or wait, then re-run.`,
      );
    }
  }
  fs.writeFileSync(lp, String(process.pid));
  return lp;
}

function release(lp) {
  if (lp && fs.existsSync(lp)) {
    try {
      fs.unlinkSync(lp);
    } catch {
      // best-effort
    }
  }
}

module.exports = { acquire, release, pidAlive };
