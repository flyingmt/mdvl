// Seam C, Windows half — the User PATH writer against a real registry.
//
// mdvl 0.1.x wiped the User PATH of everyone who installed it on Windows
// (#27/#29). Six destruction paths were documented and five were live in the
// code at once, so no single-cause fix is trustworthy: every one of them gets
// a case here, and every case asserts that the value that was already there
// survived character for character.
//
// These run against a scratch key under HKCU\Software, never against the real
// HKCU\Environment — a test that reproduces a PATH wipe must not be able to
// reproduce it on the machine running it. The real Path value is snapshotted
// at the start and asserted unchanged at the end, so a writer that ignores the
// key it was handed is caught rather than trusted.

const assert = require("assert");
const { execFileSync } = require("child_process");

const { configureWindowsPath, removeWindowsPath } = require("../lib/shells");

const SCRATCH_ROOT = "Software\\mdvl-installer-tests";
const MDVL_DIR = "C:\\Users\\tester\\.local\\bin";

if (process.platform !== "win32") {
  console.log(
    "Seam C (Windows) SKIPPED — needs a real registry. " +
      "Nothing here was verified on " +
      process.platform +
      ".",
  );
  process.exit(0);
}

// -EncodedCommand with shell:false, for the same reason the writer uses it:
// nothing about the value crosses a cmd command line. Values move in and out
// as base64 of UTF-16LE so the harness itself cannot be what corrupts a
// non-ASCII path, and readback goes through [Console]::Out.Write rather than
// Write-Output, which wraps long strings at the formatter's console width.
function ps(script) {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function seed(subkey, name, value, kind) {
  const payload = Buffer.from(value, "utf16le").toString("base64");
  const set =
    kind === "MultiString"
      ? `$k.SetValue('${name}', [string[]]@($v), [Microsoft.Win32.RegistryValueKind]::MultiString)`
      : `$k.SetValue('${name}', $v, [Microsoft.Win32.RegistryValueKind]::${kind})`;
  ps(
    `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${subkey}')\n` +
      `$v = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${payload}'))\n` +
      `${set}\n$k.Close()\n`,
  );
}

function createEmpty(subkey) {
  ps(
    `[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${subkey}').Close()\n`,
  );
}

// Returns { kind, value } — or { kind: null } when the key or value is absent.
function read(subkey, name) {
  const out = ps(
    `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${subkey}')\n` +
      `if ($null -eq $k) { [Console]::Out.Write('ABSENT '); exit 0 }\n` +
      `$v = $k.GetValue('${name}', $null, 'DoNotExpandEnvironmentNames')\n` +
      `if ($null -eq $v) { [Console]::Out.Write('ABSENT '); exit 0 }\n` +
      `$b = [System.Text.Encoding]::Unicode.GetBytes([string]$v)\n` +
      `[Console]::Out.Write($k.GetValueKind('${name}').ToString() + ' ' + [Convert]::ToBase64String($b))\n`,
  );
  const gap = out.indexOf(" ");
  const kind = out.slice(0, gap);
  if (kind === "ABSENT") return { kind: null, value: null };
  return {
    kind,
    value: Buffer.from(out.slice(gap + 1), "base64").toString("utf16le"),
  };
}

let caseCount = 0;
function scratchKey() {
  caseCount += 1;
  return `${SCRATCH_ROOT}\\case${caseCount}\\Environment`;
}

// The one assertion every destructive case shares: whatever was on PATH before
// is still on PATH after, verbatim, with mdvl's directory in front of it.
function assertPrepended(title, key, original) {
  const after = read(key, "Path");
  assert.ok(
    after.value !== null && after.value.includes(original),
    `${title}: the PATH that was already there did not survive verbatim.\n` +
      `  before: ${JSON.stringify(original)}\n` +
      `  after:  ${JSON.stringify(after.value)}`,
  );
  assert.strictEqual(
    after.value,
    `${MDVL_DIR};${original}`,
    `${title}: mdvl must be prepended and nothing else may change`,
  );
  assert.strictEqual(
    after.kind,
    "ExpandString",
    `${title}: the value must be written back as REG_EXPAND_SZ, always — ` +
      `REG_SZ freezes every %VAR% already on the PATH`,
  );
}

function assertSkippedNotWritten(title, result) {
  assert.match(
    result,
    /^skipped/,
    `${title}: an unreadable PATH must report a skip, not a success`,
  );
  assert.ok(
    !result.startsWith("PATH added"),
    `${title}: bin/mdvl.js:132 reads "PATH added" as success and would print a checkmark`,
  );
  assert.ok(
    !result.includes("already"),
    `${title}: bin/mdvl.js:132 reads "already" as success and would print a checkmark`,
  );
}

function run() {
  const guard = read("Environment", "Path");

  try {
    // === 1. the value is named PATH, not Path (#29 candidate 1) ===
    // The old reader matched /Path\s+REG(?:_EXPAND_)?SZ\s+(.*)/ against
    // `reg query` output. Registry value names are case-insensitive, so a key
    // holding `PATH` is completely ordinary — and the regex missed it, the
    // read "succeeded" with an empty string, and the write wiped it.
    console.log("Testing an uppercase PATH value name...");
    {
      const key = scratchKey();
      const original = "C:\\Windows\\system32;C:\\Windows";
      seed(key, "PATH", original, "ExpandString");
      configureWindowsPath(MDVL_DIR, key);
      assertPrepended("uppercase PATH", key, original);
    }
    console.log("  uppercase PATH value name OK");

    // === 2a. no Path value at all — absence is not unreadability ===
    // A user who has never had a User PATH has no value to lose, and creating
    // one is the correct outcome. This is the branch that must stay open when
    // the unreadable branch closes (ADR-0007, from rustup's split of
    // ERROR_FILE_NOT_FOUND from ERROR_INVALID_DATA).
    console.log("Testing an absent Path value...");
    {
      const key = scratchKey();
      createEmpty(key);
      const result = configureWindowsPath(MDVL_DIR, key);
      const after = read(key, "Path");
      assert.strictEqual(
        after.value,
        MDVL_DIR,
        "an absent PATH is safe to create — there is nothing to lose",
      );
      assert.strictEqual(
        after.kind,
        "ExpandString",
        "a newly created PATH is REG_EXPAND_SZ like every other write",
      );
      assert.ok(
        result[0].startsWith("PATH added"),
        `creating an absent PATH is a success, got: ${result[0]}`,
      );
    }
    console.log("  absent Path value OK");

    // === 2b. the value cannot be read — fail closed (#29 candidate 2) ===
    // The old code caught every read failure and substituted "", then wrote.
    // A Path of an unexpected type is the readable-key/unreadable-value case:
    // the writer must leave it exactly as it found it and tell the human.
    console.log("Testing an unreadable Path value...");
    {
      const key = scratchKey();
      const original = "C:\\Windows\\system32";
      seed(key, "Path", original, "MultiString");
      const result = configureWindowsPath(MDVL_DIR, key);
      const after = read(key, "Path");
      assert.strictEqual(
        after.kind,
        "MultiString",
        "a PATH that could not be read must not be replaced by one that could be written",
      );
      assert.ok(
        !after.value.includes(MDVL_DIR),
        "nothing may be written to a value that was not successfully read",
      );
      assert.strictEqual(
        after.value,
        original,
        "the value the writer refused to understand must survive untouched",
      );
      assertSkippedNotWritten("unreadable PATH", result[0]);
    }
    console.log("  unreadable Path value OK");

    // === 3. a non-ASCII path (#29 candidate 3, pnpm#4698) ===
    // `reg query`'s stdout came back in the console code page. On a Korean
    // Windows that is cp949, Node decoded it as UTF-8, and every non-ASCII
    // path on the PATH came back as replacement characters — which were then
    // written back over the originals.
    console.log("Testing a non-ASCII PATH...");
    {
      const key = scratchKey();
      const original = "C:\\사용자\\바탕화면\\도구;C:\\Windows;D:\\プログラム";
      seed(key, "Path", original, "ExpandString");
      configureWindowsPath(MDVL_DIR, key);
      assertPrepended("non-ASCII PATH", key, original);
    }
    console.log("  non-ASCII PATH OK");

    // === 4. %VAR% references must not expand (#29 candidate 4, rustup#261) ===
    // Reading through anything that expands, or writing back as REG_SZ, turns
    // %USERPROFILE%\bin into one user's absolute path and freezes it there.
    console.log("Testing %VAR% references...");
    {
      const key = scratchKey();
      const original =
        "%USERPROFILE%\\bin;%SystemRoot%\\system32;%LOCALAPPDATA%\\Programs";
      seed(key, "Path", original, "ExpandString");
      configureWindowsPath(MDVL_DIR, key);
      assertPrepended("%VAR% references", key, original);

      const after = read(key, "Path");
      assert.ok(
        after.value.includes("%USERPROFILE%"),
        "%USERPROFILE% must still be a reference, not one machine's expansion of it",
      );
    }
    console.log("  %VAR% references OK");

    // === 5. a trailing backslash (#29 candidate 5) ===
    // `reg add ... /d "C:\tools\"` — the backslash escapes the closing quote
    // and cmd's parse of the whole command collapses.
    console.log("Testing trailing backslashes...");
    {
      const key = scratchKey();
      const original = "C:\\tools\\;C:\\Program Files\\Git\\bin\\";
      seed(key, "Path", original, "ExpandString");
      configureWindowsPath(MDVL_DIR, key);
      assertPrepended("trailing backslash", key, original);
    }
    console.log("  trailing backslashes OK");

    // === 6. cmd metacharacters (#29 candidate 6) ===
    // & ^ | > are all legal in a directory name and all meaningful to cmd.
    console.log("Testing cmd metacharacters...");
    {
      const key = scratchKey();
      const original = "C:\\a&b;C:\\c^d;C:\\e(f);C:\\g h;C:\\i;j";
      seed(key, "Path", original, "ExpandString");
      configureWindowsPath(MDVL_DIR, key);
      assertPrepended("cmd metacharacters", key, original);
    }
    console.log("  cmd metacharacters OK");

    // === 7. empty segments belong to whoever put them there ===
    // The old code ran .filter(Boolean) over the split, silently deleting empty
    // segments. mdvl does not own the other entries on a PATH and does not get
    // to tidy them.
    console.log("Testing empty PATH segments...");
    {
      const key = scratchKey();
      const original = "C:\\a;;C:\\b;";
      seed(key, "Path", original, "ExpandString");
      configureWindowsPath(MDVL_DIR, key);
      assertPrepended("empty segments", key, original);
    }
    console.log("  empty PATH segments OK");

    // === 8. a long PATH is written, not refused ===
    // The 2048-character throw was never a registry limit — it guarded a `setx`
    // the installer does not use. It threw past bin/mdvl.js:127, unwinding an
    // install whose binary and receipt were already on disk, which is the same
    // failure 806f6ad fixed for fish.
    console.log("Testing a long PATH...");
    {
      const key = scratchKey();
      const original = Array.from(
        { length: 60 },
        (_, i) => `C:\\Program Files\\vendor-${i}\\some\\deep\\bin`,
      ).join(";");
      assert.ok(original.length > 2048, "the fixture must exceed the old limit");
      seed(key, "Path", original, "ExpandString");
      const result = configureWindowsPath(MDVL_DIR, key);
      assertPrepended("long PATH", key, original);
      assert.ok(
        result[0].startsWith("PATH added"),
        `a long PATH is written like any other, got: ${result[0]}`,
      );
    }
    console.log("  long PATH OK");

    // === 9. already present is recognised without a write ===
    console.log("Testing an already-configured PATH...");
    {
      const key = scratchKey();
      const original = `${MDVL_DIR};C:\\Windows`;
      seed(key, "Path", original, "ExpandString");
      const result = configureWindowsPath(MDVL_DIR, key);
      assert.strictEqual(
        read(key, "Path").value,
        original,
        "a PATH that already has mdvl on it must not be rewritten",
      );
      assert.ok(
        result[0].includes("already"),
        `expected an already-configured result, got: ${result[0]}`,
      );
    }
    console.log("  already-configured PATH OK");

    // === 10. removal takes mdvl's entry and nothing else ===
    // The decision applies to both directions; removeWindowsPath being
    // accidentally safer today is not something to build on.
    console.log("Testing removal...");
    {
      const key = scratchKey();
      // One entry is padded with spaces: a hand-edited PATH often reads
      // `C:\foo; C:\bar`, and the padding belongs to whoever typed it. Without
      // it here, normalising every kept entry passes unnoticed.
      const others =
        "%USERPROFILE%\\bin; C:\\사용자\\도구\\ ;C:\\a&b;;C:\\Windows\\system32";
      seed(key, "Path", `${MDVL_DIR};${others}`, "ExpandString");
      const result = removeWindowsPath(MDVL_DIR, key);
      const after = read(key, "Path");
      assert.strictEqual(
        after.value,
        others,
        "removal must take mdvl's entry and leave every other one byte for byte",
      );
      assert.strictEqual(
        after.kind,
        "ExpandString",
        "removal writes back as REG_EXPAND_SZ like every other write",
      );
      assert.ok(
        !result[0].startsWith("skipped"),
        `expected a removal, got: ${result[0]}`,
      );
    }
    console.log("  removal OK");

    // === 11. removal fails closed too ===
    console.log("Testing removal against an unreadable PATH...");
    {
      const key = scratchKey();
      const original = "C:\\Windows\\system32";
      seed(key, "Path", original, "MultiString");
      const result = removeWindowsPath(MDVL_DIR, key);
      const after = read(key, "Path");
      assert.strictEqual(
        after.kind,
        "MultiString",
        "an unreadable PATH is not rewritten on the way out either",
      );
      assert.strictEqual(
        after.value,
        original,
        "uninstall must not be able to destroy what install refused to touch",
      );
      assertSkippedNotWritten("unreadable PATH on removal", result[0]);
    }
    console.log("  removal against an unreadable PATH OK");
  } finally {
    ps(
      `[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${SCRATCH_ROOT}', $false)\n`,
    );
  }

  // The whole point of the scratch key is that the real one is never touched.
  // If a writer ignores the key it is handed, this is what says so.
  const guardAfter = read("Environment", "Path");
  assert.strictEqual(
    guardAfter.kind,
    guard.kind,
    "the real HKCU\\Environment Path changed type while the scratch tests ran",
  );
  assert.strictEqual(
    guardAfter.value,
    guard.value,
    "the real HKCU\\Environment Path was modified by a test that was handed a scratch key",
  );

  console.log("All Seam C Windows User PATH tests passed.");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}
