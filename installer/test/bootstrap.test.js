const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const { hash, hashFile, verify } = require("../lib/checksum");
const { create, read, write, remove } = require("../lib/receipt");
const { detect, childPackage, binaryName } = require("../lib/platform");
const {
  MARKER_BEGIN,
  MARKER_END,
  buildPathFragment,
  configureFishPath,
} = require("../lib/shells");

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

  // === PATH fragment is idempotent (#25) ===
  // The fragment is sourced from every startup file a shell reads, so it runs
  // more than once per shell and again in every nested shell. It shipped as an
  // unconditional prepend and PATH accumulated — six copies of the same
  // directory on a real machine. Sourcing it twice is the only assertion that
  // would have caught that, so that is what this does. Run under `sh` as well
  // as the caller's shell: the fragment must stay POSIX.
  console.log("Testing PATH fragment...");
  const fragmentDir = path.join(tmp, "bin");
  const fragmentFile = path.join(tmp, "fragment.sh");
  fs.writeFileSync(fragmentFile, buildPathFragment(fragmentDir));

  for (const sh of ["sh", "bash", "zsh"]) {
    let out;
    try {
      out = execFileSync(
        sh,
        ["-c", `. "${fragmentFile}"; . "${fragmentFile}"; printf %s "$PATH"`],
        { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } },
      );
    } catch {
      continue; // shell not installed on this runner
    }
    const hits = out.split(":").filter((p) => p === fragmentDir).length;
    assert.strictEqual(
      hits,
      1,
      `${sh}: sourcing the fragment twice put ${fragmentDir} on PATH ${hits} times`,
    );
    assert.strictEqual(
      out.split(":")[0],
      fragmentDir,
      `${sh}: fragment did not put ${fragmentDir} first on PATH`,
    );
  }
  console.log("  PATH fragment OK");

  // === an unwritable fish conf.d is a skip, not a throw (#26) ===
  // fish is detected from the existence of ~/.config/fish alone, and that
  // directory can belong to someone else — on one machine it was root-owned
  // and fish was not installed. This branch used to throw, unwinding an
  // install whose binary and receipt were already committed, so the user was
  // told a successful install had failed.
  console.log("Testing fish conf.d fallback...");
  if (process.getuid && process.getuid() === 0) {
    console.log("  fish conf.d fallback SKIPPED (running as root)");
  } else {
    const xdg = path.join(tmp, "xdg");
    const lockedFish = path.join(xdg, "fish");
    fs.mkdirSync(lockedFish, { recursive: true });
    fs.chmodSync(lockedFish, 0o555);

    const priorXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      const result = configureFishPath(path.join(tmp, "bin"));
      assert.match(
        result,
        /^skipped fish conf\.d/,
        `expected a skip, got: ${result}`,
      );
    } finally {
      if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = priorXdg;
      fs.chmodSync(lockedFish, 0o755);
    }

    // And it still reports success when the directory is writable.
    const openXdg = path.join(tmp, "xdg-open");
    fs.mkdirSync(path.join(openXdg, "fish"), { recursive: true });
    process.env.XDG_CONFIG_HOME = openXdg;
    try {
      assert.strictEqual(
        configureFishPath(path.join(tmp, "bin")),
        "PATH added to fish conf.d",
      );
    } finally {
      if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = priorXdg;
    }
    console.log("  fish conf.d fallback OK");
  }

  // === published package contents ===
  // bin/mdvl.js reads <package>/checksums.json and refuses to install without
  // it, so a tarball that omits the file installs nothing. CI writes the file
  // into installer/ just before publishing, which makes it easy to believe it
  // ships — only `npm pack` knows what the `files` field actually lets through.
  console.log("Testing published package contents...");
  const pkgRoot = path.join(__dirname, "..");
  const checksums = path.join(pkgRoot, "checksums.json");
  // A fresh clone has no checksums.json; it arrives from a CI artifact. Stand
  // one in so this tests the packing rules rather than the working tree.
  const borrowed = !fs.existsSync(checksums);
  if (borrowed) fs.writeFileSync(checksums, "{}\n");
  try {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: pkgRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )[0].files.map((f) => f.path);

    for (const required of ["checksums.json", "bin/mdvl.js", "lib/checksum.js"]) {
      assert.ok(
        packed.includes(required),
        `${required} is missing from the published tarball — packed: ${packed.join(", ")}`,
      );
    }
  } finally {
    if (borrowed) fs.rmSync(checksums, { force: true });
  }
  console.log("  published package contents OK");

  // cleanup
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("All Seam C unit tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
