const fs = require("fs");
const path = require("path");

const RECEIPT_FILE = "receipt.json";

function receiptPath(stateDir) {
  return path.join(stateDir, RECEIPT_FILE);
}

function read(stateDir) {
  const p = receiptPath(stateDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function write(stateDir, receipt) {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = path.join(stateDir, `.${RECEIPT_FILE}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2));
  fs.renameSync(tmp, receiptPath(stateDir));
}

function remove(stateDir) {
  const p = receiptPath(stateDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function create(version, target, sha256) {
  return {
    version,
    target,
    sha256,
    installDate: new Date().toISOString(),
  };
}

module.exports = { receiptPath, read, write, remove, create };
