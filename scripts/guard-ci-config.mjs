#!/usr/bin/env node
// Fails a fork's pull request that touches CI or test configuration, so a
// maintainer reads that part first. CI runs the base's copy of this script,
// so a fork can't change the guard to pass itself.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** CI itself, and what decides what its jobs run and pass. */
export const GUARDED =
  /^(\.github\/|scripts\/ci-changes\.mjs$|scripts\/guard-ci-config\.mjs$|scripts\/check-[\w-]+\.mjs$|playwright(\.[\w-]+)?\.config\.ts$|vite(\.[\w-]+)?\.config\.ts$|eslint\.config\.js$|tsconfig(\.[\w-]+)?\.json$|\.nvmrc$)/;

/** The files of `changed` that are CI or test configuration. */
export function guarded(changed) {
  return changed.filter((file) => GUARDED.test(file));
}

function changedBetween(base, head) {
  return execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? process.argv[at + 1] : "";
  };
  const base = arg("--base");
  if (!base) {
    console.error("usage: guard-ci-config.mjs --base SHA [--head SHA]");
    process.exit(2);
  }
  const touched = guarded(changedBetween(base, arg("--head") || "HEAD"));
  for (const file of touched)
    console.log(
      `::error file=${file}::A pull request from a fork changes CI or the test configuration. A maintainer reviews this first; please leave tests and CI as they are and say in the pull request what you need changed.`,
    );
  if (touched.length > 0) process.exit(1);
  console.log("No CI or test configuration changed.");
}
