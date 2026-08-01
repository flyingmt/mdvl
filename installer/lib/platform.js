const os = require("os");
const path = require("path");

function detect() {
  const platform = process.platform;
  const arch = process.arch;
  const libc =
    process.report?.header?.libc ||
    (typeof process.versions?.libc === "string"
      ? process.versions.libc
      : undefined);

  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";

  throw new Error(
    `Unsupported platform: ${platform}-${arch}. ` +
      `Supported: darwin-arm64, darwin-x64, windows-x64, linux-x64 (glibc), linux-arm64 (glibc).`,
  );
}

function childPackage(target) {
  return `@flyingmt/mdvl-${target}`;
}

function binaryName(target) {
  return target.startsWith("windows") ? "mdvl.exe" : "mdvl";
}

function resolveChildBinary(target) {
  const pkg = childPackage(target);
  const name = binaryName(target);
  let pkgPath;
  try {
    pkgPath = require.resolve(`${pkg}/package.json`);
  } catch {
    throw new Error(
      `No binary found for ${target}. ` +
        `The platform-specific package ${pkg} was not installed. ` +
        `This may indicate an unsupported platform or a partial npm install.`,
    );
  }
  return path.join(path.dirname(pkgPath), name);
}

module.exports = { detect, childPackage, binaryName, resolveChildBinary };
