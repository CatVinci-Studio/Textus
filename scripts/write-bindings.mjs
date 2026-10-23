#!/usr/bin/env node
// Writes src/platform/bindings/ again from the Rust commands - `npm run
// bindings`, after changing a command's signature or a type it takes or
// answers. The generator is a Rust test (src-tauri/src/bindings.rs), which
// otherwise only checks that the files are current: `cargo test` (and so
// `npm run check:native` and CI's native jobs) fails while they are not.
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
