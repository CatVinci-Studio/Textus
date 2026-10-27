#!/usr/bin/env node
// Everything a pull request is checked for: frontend checks, e2e flows and
// native checks, stopping at the first that fails.
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
