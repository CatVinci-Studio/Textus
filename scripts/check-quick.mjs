#!/usr/bin/env node
// A quick `npm run check` while you work - `npm run check:quick`: the whole
// typecheck, then lint, formatting and the unit tests for only the files
// your branch changed since it left origin/main, committed or not. The
// tests are those `vitest related` finds: the changed test files and the
// tests that import a changed file. The save round trip
// (src/document-view/save-roundtrip*.test.ts), half of `npm test`'s time,
// runs only when a change can reach saving, as in CI
// (scripts/ci-changes.mjs).
//
// It is a shortcut, not a replacement: run `npm run check` before you open
// a pull request. Same on Linux, macOS and Windows.
//
//   node scripts/check-quick.mjs                 (against origin/main)
//   node scripts/check-quick.mjs --base REF      (against another branch)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reachesSaving } from "./ci-changes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function run(command, args, env = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // npm and npx are .cmd files on Windows, which only a shell resolves.
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
const at = args.indexOf("--base");
const base = git(
  "merge-base",
  "HEAD",
  at >= 0 ? args[at + 1] : "origin/main",
)[0];
const changed = [
  ...new Set([
    ...git("diff", "--name-only", "--no-renames", base),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
];
const present = changed.filter((file) => existsSync(join(root, file)));
const scripts = present.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
console.log(
  `${changed.length} file(s) changed since ${base.slice(0, 10)} (origin/main's merge base).`,
);

run("npm", ["run", "typecheck"]);
if (scripts.length > 0)
  run("npx", [
    "eslint",
    "--max-warnings",
    "0",
    "--no-warn-ignored",
    ...scripts,
  ]);
if (present.length > 0)
  run("npx", ["prettier", "--check", "--ignore-unknown", ...present]);
// Files under src/ that aren't code (help guides, stylesheets) count too:
// tests import them. The round trip reads its documents from disk, so no
// import leads to it: it is named when the change can reach saving.
const roundtrip = reachesSaving({ files: changed, push: false });
const related = [
  ...new Set([
    ...scripts,
    ...present.filter((file) => file.startsWith("src/")),
    ...(roundtrip
      ? readdirSync(join(root, "src/document-view"))
          .filter((name) => /^save-roundtrip.*\.test\.ts$/.test(name))
          .map((name) => `src/document-view/${name}`)
      : []),
  ]),
];
if (related.length > 0)
  run(
    "npx",
    ["vitest", "related", "--run", "--passWithNoTests", ...related],
    roundtrip ? {} : { TEXTUS_SKIP_ROUNDTRIP: "1" },
  );
run("node", ["scripts/check-versions.mjs"]);
console.log("\nQuick checks passed; run npm run check before a pull request.");
