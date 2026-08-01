const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const { hash, hashFile, verify } = require("../lib/checksum");
const { create, read, write, remove } = require("../lib/receipt");
const { detect, childPackage, binaryName } = require("../lib/platform");
const { MARKER_BEGIN, MARKER_END } = require("../lib/shells");

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdvl-test-"));
  return dir;
}

async function run() {
  // === checksum ===
  console.log("Testing checksum...");

  const data = Buffer.from("hello mdvl");
  const expected = crypto.createHash("sha256").update(data).digest("hex");
  assert.strictEqual(hash(data), expected);

  const tmp = tmpDir();
  const binPath = path.join(tmp, "fake-binary");
  fs.writeFileSync(binPath, data);
  assert.strictEqual(await hashFile(binPath), expected);

  await assert.rejects(verify(binPath, "0".repeat(64)), /checksum mismatch/);
  await verify(binPath, expected);
  console.log("  checksum OK");

  // === receipt ===
  console.log("Testing receipt...");
  const stateDir = path.join(tmp, "state");
  assert.strictEqual(read(stateDir), null);

  const r = create("0.2.0", "darwin-arm64", expected);
  write(stateDir, r);
  const readBack = read(stateDir);
  assert.strictEqual(readBack.version, "0.2.0");
  assert.strictEqual(readBack.target, "darwin-arm64");
  assert.strictEqual(readBack.sha256, expected);
  assert.ok(readBack.installDate);

  remove(stateDir);
  assert.strictEqual(read(stateDir), null);
  console.log("  receipt OK");

  // === platform ===
  console.log("Testing platform...");
  const target = detect();
  assert.ok(
    /^(darwin-arm64|darwin-x64|windows-x64|linux-x64|linux-arm64)$/.test(
      target,
    ),
    `unexpected target: ${target}`,
  );
  assert.ok(childPackage(target).startsWith("@flyingmt/mdvl-"));
  assert.ok(binaryName(target).startsWith("mdvl"));
  console.log("  platform OK");

  // === shell marker ===
  console.log("Testing shell markers...");
  assert.ok(MARKER_BEGIN.includes("mdvl"));
  assert.ok(MARKER_END.includes("mdvl"));
  console.log("  shell markers OK");

  // cleanup
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("All Seam C unit tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
