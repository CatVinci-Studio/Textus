#!/usr/bin/env node
// Checks that every file carrying the app's version agrees on it:
// package.json, both version fields of package-lock.json, the [package] of
// src-tauri/Cargo.toml, the textus entry of src-tauri/Cargo.lock and
// src-tauri/tauri.conf.json. A bump that misses one ships an app whose
// About box, updater manifest and installer names disagree - the release
// workflow names files after tauri.conf.json, the updater compares against
// Cargo's version.
//
//   node scripts/check-versions.mjs                 (exit 1 on a mismatch)
//   node scripts/check-versions.mjs --tag v1.2.3    (also: the tag, minus
//                                                    "v" or "ios-v", matches;
//                                                    for a stable vX.Y.Z, no
//                                                    release-note fragments
//                                                    are left unassembled)
//   node scripts/check-versions.mjs --print         (print the version)
//   node scripts/check-versions.mjs --root DIR      (check another checkout,
//                                                    e.g. an old tag's)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unreleasedProblems } from "./release-notes.mjs";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reader = (root) => (file) => readFileSync(join(root, file), "utf8");

/** The `version = "..."` line of the first TOML table matching `header`
 *  (a regex source for the lines that open it). */
function tomlVersion(text, header) {
  const table = text.match(
    new RegExp(`${header}([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m"),
  );
  return table?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

export function collectVersions(readFile = reader(ownRoot)) {
  const pkg = JSON.parse(readFile("package.json"));
  const lock = JSON.parse(readFile("package-lock.json"));
  const tauri = JSON.parse(readFile("src-tauri/tauri.conf.json"));
  return {
    "package.json": pkg.version,
    "package-lock.json (version)": lock.version,
    'package-lock.json (packages[""].version)': lock.packages?.[""]?.version,
    "src-tauri/Cargo.toml": tomlVersion(
      readFile("src-tauri/Cargo.toml"),
      "^\\[package\\]\\s*$",
    ),
    "src-tauri/Cargo.lock (textus)": tomlVersion(
      readFile("src-tauri/Cargo.lock"),
      '^\\[\\[package\\]\\]\\s*\\nname = "textus"\\s*$',
    ),
    "src-tauri/tauri.conf.json": tauri.version,
  };
}

/** Problems with `versions` (and `tag`, when given), one line each. */
export function versionProblems(versions, tag) {
  const problems = [];
  const expected = versions["package.json"];
  for (const [file, version] of Object.entries(versions)) {
    if (!version) problems.push(`${file}: no version found`);
    else if (version !== expected)
      problems.push(`${file}: ${version} (package.json has ${expected})`);
  }
  if (tag !== undefined) {
    const fromTag = tag.replace(/^(ios-)?v/, "");
    if (fromTag !== expected)
      problems.push(`tag ${tag} names ${fromTag}, but the app is ${expected}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    if (!args[at + 1]) {
      console.error(`${name} needs a value`);
      process.exit(2);
    }
    return args[at + 1];
  };
  const tag = option("--tag");
  const root = option("--root") ?? ownRoot;
  const versions = collectVersions(reader(root));
  const problems = versionProblems(versions, tag);
  if (problems.length > 0) {
    console.error("Version mismatch:");
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      "Bump every file listed above together (CONTRIBUTING.md, Releases).",
    );
    process.exit(1);
  }
  // A stable desktop tag also needs its release notes assembled from the
  // fragments (scripts/release-notes.mjs).
  const notesProblems =
    tag && /^v[^-]+$/.test(tag) ? unreleasedProblems(root, tag.slice(1)) : [];
  if (notesProblems.length > 0) {
    console.error("Release notes not ready:");
    for (const p of notesProblems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (args.includes("--print")) console.log(versions["package.json"]);
}
