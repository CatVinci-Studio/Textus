#!/usr/bin/env node
// Regenerates the TypeScript bindings from the Rust commands, through the
// Rust test that otherwise only checks they are current.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "cargo",
  ["test", "--lib", "bindings::bindings_are_current"],
  {
    cwd: join(root, "src-tauri"),
    stdio: "inherit",
    env: { ...process.env, TEXTUS_WRITE_BINDINGS: "1" },
  },
);
if (result.error) {
  console.error(`could not run cargo: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
