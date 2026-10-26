#!/usr/bin/env node
// The native checks CI runs: rustfmt, clippy with warnings as errors, and
// the Rust tests. The crate embeds dist/, so a missing one is built first.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const native = join(root, "src-tauri");

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    // npm is npm.cmd on Windows, which only a shell resolves.
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(join(root, "dist", "index.html")))
  run("npm", ["run", "build"], root);

run("cargo", ["fmt", "--all", "--", "--check"], native);
run(
  "cargo",
  ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  native,
);
run("cargo", ["test", "--workspace"], native);
