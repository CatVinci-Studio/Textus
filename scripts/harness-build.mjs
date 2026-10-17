import { access, readFile, writeFile, cp, rm, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
export function runtimeTarget(
  target,
  platform = process.platform,
  arch = process.arch,
) {
  if (!target) return { platform, arch };
  return {
    platform: target.includes("apple-darwin")
      ? "darwin"
      : target.includes("windows")
        ? "win32"
        : target.includes("linux")
          ? "linux"
          : target.includes("ios")
            ? "ios"
            : platform,
    arch: target.startsWith("x86_64")
      ? "x64"
      : target.startsWith("aarch64")
        ? "arm64"
        : arch,
  };
}
export async function ensureDependencies(
  root,
  run = (args) =>
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    }),
) {
  try {
    await access(
      join(root, "node_modules/@deepseek-ai/dsh-sdk-client/package.json"),
    );
  } catch {
    run(["ci", "--prefix", root, "--no-audit", "--no-fund"]);
  }
}
export async function stageNode(dest, target) {
  const version = "v24.11.1";
  const output = join(dest, target.platform === "win32" ? "node.exe" : "node");
  if (
    target.platform === process.platform &&
    target.arch === process.arch &&
    process.version === version
  ) {
    await cp(process.execPath, output);
    try {
      await cp(
        join(dirname(process.execPath), "..", "LICENSE"),
        join(dest, "LICENSE.node"),
      );
    } catch {
      const response = await fetch(
        `https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`,
      );
      if (!response.ok) throw new Error("Cannot stage Node license");
      await writeFile(join(dest, "LICENSE.node"), await response.text());
    }
    return version;
  }
  if (target.platform === "win32")
    throw new Error(
      "Windows Node cross-packaging requires a matching Node 24.11.1 builder.",
    );
  const archive = `node-${version}-${target.platform}-${target.arch}.tar.gz`;
  const base = `https://nodejs.org/dist/${version}/`;
  const sums = await fetch(base + "SHASUMS256.txt").then((r) => {
    if (!r.ok) throw new Error("Cannot fetch Node checksums");
    return r.text();
  });
  const expected = sums
    .split("\n")
    .find((line) => line.endsWith("  " + archive))
    ?.split(/\s+/)[0];
  if (!expected) throw new Error("No official checksum for " + archive);
  const response = await fetch(base + archive);
  if (!response.ok) throw new Error("Cannot download target Node");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Node archive checksum mismatch");
  const temp = await mkdtemp(join(tmpdir(), "textus-node-"));
  try {
    await writeFile(join(temp, "node.tar.gz"), bytes);
    execFileSync("tar", ["-xzf", join(temp, "node.tar.gz"), "-C", temp]);
    const binary = join(temp, archive.slice(0, -7), "bin/node");
    if (target.platform === "darwin") {
      const data = await readFile(binary);
      const cpu = data.readUInt32LE(4);
      if (cpu !== (target.arch === "x64" ? 0x01000007 : 0x0100000c))
        throw new Error("Node Mach-O architecture mismatch");
    }
    await cp(binary, output);
    await cp(
      join(temp, archive.slice(0, -7), "LICENSE"),
      join(dest, "LICENSE.node"),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return version;
}
