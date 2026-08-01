const crypto = require("crypto");
const fs = require("fs");

function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => h.update(chunk));
    stream.on("end", () => resolve(h.digest("hex")));
    stream.on("error", reject);
  });
}

async function verify(filePath, expectedSha256) {
  const actual = await hashFile(filePath);
  if (actual !== expectedSha256) {
    throw new Error(
      `checksum mismatch (expected ${expectedSha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...)`,
    );
  }
  return true;
}

module.exports = { hash, hashFile, verify };
