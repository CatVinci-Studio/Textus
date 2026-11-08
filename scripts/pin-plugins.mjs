#!/usr/bin/env node
// Points CI at a textus-plugins commit: the e2e jobs check the official
// plugins out at the commit ci.yml names, so a run can be repeated.
//
//   node scripts/pin-plugins.mjs           # textus-plugins' main, now
//   node scripts/pin-plugins.mjs <sha>     # a commit of your choosing
//   node scripts/pin-plugins.mjs --check   # print the pin; fail if two differ
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = ".github/workflows/ci.yml";
const REPO = "https://github.com/CatVinci-Studio/textus-plugins";
const PIN =
  /(repository: CatVinci-Studio\/textus-plugins\n(?:\s+\S.*\n)*?\s+ref: )([0-9a-f]{40})/g;

const text = readFileSync(FILE, "utf8");
const pins = [...text.matchAll(PIN)].map((m) => m[2]);
if (pins.length === 0) throw new Error(`${FILE}: no textus-plugins ref`);
if (new Set(pins).size > 1) {
  console.error(`${FILE}: the jobs pin different commits: ${pins.join(", ")}`);
  process.exit(1);
}
const arg = process.argv[2];
if (arg === "--check") {
  console.log(`textus-plugins pinned at ${pins[0]}`);
  process.exit(0);
}
const sha =
  arg ??
  execFileSync("git", ["ls-remote", REPO, "refs/heads/main"], {
    encoding: "utf8",
  }).split(/\s/)[0];
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit: ${sha}`);
writeFileSync(FILE, text.replace(PIN, `$1${sha}`));
console.log(`textus-plugins: ${pins[0].slice(0, 7)} -> ${sha.slice(0, 7)}`);
