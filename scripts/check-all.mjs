#!/usr/bin/env node
// Everything a pull request is checked for - `npm run check:all`, before
// opening one: the frontend checks, the e2e flows and the native checks,
// in that order, stopping at the first that fails. Same on every platform.
import { spawnSync } from "node:child_process";

for (const script of ["check", "test:e2e", "check:native"]) {
  console.log(`\n=== npm run ${script}`);
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\nnpm run ${script} failed.`);
    process.exit(result.status ?? 1);
  }
}
console.log("\nAll checks passed.");
