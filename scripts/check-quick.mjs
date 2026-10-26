#!/usr/bin/env node
// A quick check while you work: the whole typecheck, then lint, formatting
// and related unit tests for only the files changed since the base (default
// origin/main, or --base REF). Not a replacement for `npm run check`.
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
