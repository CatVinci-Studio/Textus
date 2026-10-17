#!/usr/bin/env node
// The native app's checks - `npm run check:native` - the same on Linux,
// macOS and Windows, and what CI's native jobs run: rustfmt, clippy with
// warnings as errors, and the Rust tests, in src-tauri/.
//
// The Tauri crate embeds the built frontend (tauri.conf.json's
// frontendDist, ../dist), so without a dist/ the frontend is built first.
// Needs Rust (rustup; rust-toolchain.toml picks the version and adds
// rustfmt and clippy) and, on Linux, the WebKitGTK development packages
// listed in CONTRIBUTING.md.
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
