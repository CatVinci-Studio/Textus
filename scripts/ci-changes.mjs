#!/usr/bin/env node
// Which CI jobs a change needs: the `changes` job of .github/workflows/ci.yml
// runs this and passes its two answers on to the other jobs.
//
//   e2e      the change can reach the browser: the Playwright flows run
//   native   the change can reach the Rust build or its tests: the three
//            native-platform jobs and the iOS build run
//
// A pull request is compared with its base:
//
//   documentation only                   neither (`check` alone)
//   a version bump only                  neither
//   the Rust backend only                native
//   the frontend only                    e2e
//   both; or CI's workflows, .nvmrc, or
//   package.json / package-lock.json
//   beyond the version                   both
//
// A bump's version lines count for nothing in a mixed change. A push to main
// or a release branch runs everything, except a version bump's merge: the
// release workflow waits for CI on the tagged commit, and that commit is
// usually the bump, which `check` (scripts/check-versions.mjs) covers alone.
//
//   node scripts/ci-changes.mjs --base SHA           (a pull request)
//   node scripts/ci-changes.mjs --base SHA --push    (a push; SHA is the
//                                                     commit before it)
//
// Prints `e2e=...` and `native=...` lines for $GITHUB_OUTPUT. Without a
// usable base (a new branch, a force push) everything runs.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Documentation: Markdown, docs/, the issue templates and the license. */
const DOCS = /(\.md$|^docs\/|^\.github\/ISSUE_TEMPLATE\/|^LICENSE$)/;

/** Markdown in these trees is the app's own content or test input, not
 *  documentation: the skills Rust embeds (src-tauri/src/ai/skills/), the
 *  help guides and playground samples the frontend imports (?raw). */
const CODE_TREES = /^(src|e2e|src-tauri)\//;

/** Changes that run everything: CI itself, the Node version every job
 *  installs, and the npm manifest and lockfile (a bump's version lines
 *  aside). */
const EVERYTHING =
  /^(\.github\/workflows\/|\.nvmrc$|package\.json$|package-lock\.json$)/;

/** What the native jobs build and test: the Rust crates and their toolchain,
 *  the native check script and the iOS project's preparation. */
const NATIVE =
  /(^src-tauri\/|(^|\/)Cargo\.(toml|lock)$|(^|\/)\.cargo\/|(^|\/)rust-toolchain(\.toml)?$|^scripts\/check-native\.mjs$|^scripts\/ios-)/;

/** The native files the browser does see: the icons the frontend imports,
 *  boot.js (which e2e/storage.spec.ts runs) and the Tauri configs. */
const BROWSER_NATIVE =
  /^src-tauri\/(icons\/|src\/boot\.js$|tauri(\.[a-z]+)?\.conf\.json$)/;

/** A JSON file whose only change may be the version fields `paths` name. */
function jsonVersions(...paths) {
  const get = (obj, path) => path.reduce((o, key) => o?.[key], obj);
  return (before, after) => {
    const old = JSON.parse(before);
    const now = JSON.parse(after);
    for (const path of paths) {
      const parent = get(old, path.slice(0, -1));
      if (parent === undefined) return false;
      parent[path.at(-1)] = get(now, path);
    }
    return JSON.stringify(old) === JSON.stringify(now);
  };
}

/** A TOML file whose only change may be the `version = "..."` line right
 *  after `header` (a regex source for the lines that open the table). */
function tomlVersion(header) {
  const line = new RegExp(`(${header}\\nversion = ")[^"\\n]*(")`);
  return (before, after) => {
    const version = after.match(line)?.[0];
    return version !== undefined && before.replace(line, version) === after;
  };
}

/** The files a version bump touches (scripts/check-versions.mjs keeps them
 *  in step), each with the test that its change is the version alone. */
const VERSION_FILES = {
  "package.json": jsonVersions(["version"]),
  "package-lock.json": jsonVersions(["version"], ["packages", "", "version"]),
  "src-tauri/tauri.conf.json": jsonVersions(["version"]),
  "src-tauri/Cargo.toml": tomlVersion('\\[package\\]\\nname = "textus"'),
  "src-tauri/Cargo.lock": tomlVersion('\\[\\[package\\]\\]\\nname = "textus"'),
};

function versionOnly(file, before, after) {
  if (before == null || after == null || !(file in VERSION_FILES)) {
    return false;
  }
  try {
    return VERSION_FILES[file](before, after);
  } catch {
    return false; // unparsable JSON: not a bump
  }
}

/** `files` changed; `read(file)` gives a file's text `before` and `after`
 *  the change (null where it doesn't exist); `rustReads` are the files
 *  outside src-tauri/ that the Rust code embeds (rustIncludes()). */
export function classify({ files, push, read, rustReads = [] }) {
  const all = { e2e: true, native: true };
  const code = files.filter(
    (file) =>
      !DOCS.test(file) || CODE_TREES.test(file) || rustReads.includes(file),
  );
  if (code.length === 0) return push ? all : { e2e: false, native: false };
  const rest = code.filter((file) => !versionOnly(file, ...read(file)));
  if (rest.length === 0) return { e2e: false, native: false };
  if (push || rest.some((file) => EVERYTHING.test(file))) return all;
  return {
    e2e: rest.some((file) => !NATIVE.test(file) || BROWSER_NATIVE.test(file)),
    native: rest.some((file) => NATIVE.test(file) || rustReads.includes(file)),
  };
}

/** The files outside src-tauri/ that its Rust code embeds with
 *  include_str!/include_bytes! (index.html, TypeScript sources its tests
 *  compare against), as paths from the repository root. */
export function rustIncludes(root = ownRoot) {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["target", "gen", "node_modules"].includes(entry.name)) {
          walk(path);
        }
      } else if (entry.name.endsWith(".rs")) {
        const from = relative(root, dir).split("\\").join("/");
        const text = readFileSync(path, "utf8");
        for (const [, target] of text.matchAll(
          /include_(?:str|bytes)!\(\s*"([^"]+)"/g,
        )) {
          const file = posix.normalize(posix.join(from, target));
          if (!file.startsWith("src-tauri/")) found.add(file);
        }
      }
    }
  };
  walk(join(root, "src-tauri"));
  return [...found].sort();
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function show(rev, file) {
  try {
    return git("show", `${rev}:${file}`);
  } catch {
    return null;
  }
}

function main(argv) {
  const at = argv.indexOf("--base");
  const base = at === -1 ? "" : (argv[at + 1] ?? "");
  let result = { e2e: true, native: true };
  if (base && !/^0+$/.test(base)) {
    try {
      const files = git("diff", "--name-only", "--no-renames", base, "HEAD")
        .split("\n")
        .filter(Boolean);
      result = classify({
        files,
        push: argv.includes("--push"),
        read: (file) => [show(base, file), show("HEAD", file)],
        rustReads: rustIncludes(),
      });
    } catch {
      // The base isn't in this clone (a force push): run everything.
    }
  }
  console.log(`e2e=${result.e2e}\nnative=${result.native}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
