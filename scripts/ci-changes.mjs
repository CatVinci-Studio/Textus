#!/usr/bin/env node
// Which CI jobs a change needs: the `changes` job of .github/workflows/ci.yml
// runs this and passes its two answers on to the other jobs.
//
//   code      anything besides documentation and a version bump changed:
//             e2e, native and ios run
//   frontend  some of that code reaches the browser: e2e runs
//
// A pull request is compared with its base. A push to main or a release
// branch runs everything, except a version bump's merge: the release
// workflow waits for CI on the tagged commit, and that commit is usually
// the bump, which `check` (scripts/check-versions.mjs) covers on its own.
//
//   node scripts/ci-changes.mjs --base SHA           (a pull request)
//   node scripts/ci-changes.mjs --base SHA --push    (a push; SHA is the
//                                                     commit before it)
//
// Prints `code=...` and `frontend=...` lines for $GITHUB_OUTPUT. Without a
// usable base (a new branch, a force push) everything runs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Documentation: Markdown anywhere, docs/, the issue templates and the
 *  license. */
const DOCS = /(\.md$|^docs\/|^\.github\/ISSUE_TEMPLATE\/|^LICENSE$)/;

/** The files under src-tauri/ that the browser does see: the icons the
 *  frontend imports, boot.js (which e2e/storage.spec.ts runs) and the Tauri
 *  configs. */
const BROWSER_TAURI =
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
 *  the change (null where it doesn't exist). */
export function classify({ files, push, read }) {
  const code = files.filter((file) => !DOCS.test(file));
  const bump =
    code.length > 0 && code.every((file) => versionOnly(file, ...read(file)));
  if (bump) return { code: false, frontend: false };
  if (push) return { code: true, frontend: true };
  return {
    code: code.length > 0,
    frontend: code.some(
      (file) => !file.startsWith("src-tauri/") || BROWSER_TAURI.test(file),
    ),
  };
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
  let result = { code: true, frontend: true };
  if (base && !/^0+$/.test(base)) {
    try {
      const files = git("diff", "--name-only", "--no-renames", base, "HEAD")
        .split("\n")
        .filter(Boolean);
      result = classify({
        files,
        push: argv.includes("--push"),
        read: (file) => [show(base, file), show("HEAD", file)],
      });
    } catch {
      // The base isn't in this clone (a force push): run everything.
    }
  }
  console.log(`code=${result.code}\nfrontend=${result.frontend}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
