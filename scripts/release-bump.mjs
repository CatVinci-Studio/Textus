// The pure half of scripts/release.mjs: its arguments, version order, and
// the version bump of the five files check-versions.mjs compares.
import { collectVersions, versionProblems } from "./check-versions.mjs";

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;

export const USAGE =
  "usage: npm run release -- <version> [--ios] [--resume] [--dry-run]";

const FLAGS = { "--ios": "ios", "--resume": "resume", "--dry-run": "dryRun" };

/** `{ version, ios, resume, dryRun }`; throws with a message on a bad call. */
export function parseArgs(argv) {
  const opts = { version: undefined, ios: false, resume: false, dryRun: false };
  for (const arg of argv) {
    if (arg in FLAGS) opts[FLAGS[arg]] = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else if (opts.version) throw new Error(`one version only, not ${arg}`);
    else opts.version = arg.replace(/^v/, "");
  }
  if (!opts.version) throw new Error("which version?");
  if (!VERSION.test(opts.version))
    throw new Error(
      `"${opts.version}" is not a version like 1.4.8 or 1.4.8-rc.1`,
    );
  // App Store Connect takes only plain X.Y.Z, and the iOS app has no beta.
  if (opts.ios && !isStable(opts.version))
    throw new Error("--ios ships stable versions only");
  return opts;
}

export const isStable = (version) => !version.includes("-");

function parse(version) {
  const [core, pre] = version.split(/-(.*)/s);
  return { core: core.split(".").map(Number), pre: pre?.split(".") };
}

function compareIds(a, b) {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
  if (numeric.test(a) !== numeric.test(b)) return numeric.test(a) ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver order: negative when `a` comes before `b`. */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre || !y.pre) return (x.pre ? -1 : 0) - (y.pre ? -1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const order = compareIds(x.pre[i], y.pre[i]);
    if (order !== 0) return order;
  }
  return 0;
}

/** Each file's version lines, matched as written (so the diff is those
 *  lines alone, which is what makes CI take the pull request as a bump). */
const VERSION_LINES = {
  "package.json": [/^( {2}"version": ")[^"]*(")/m],
  "package-lock.json": [
    /^( {2}"version": ")[^"]*(")/m,
    /^( {4}"": \{\n {6}"name": "textus",\n {6}"version": ")[^"]*(")/m,
  ],
  "src-tauri/Cargo.toml": [
    /^(\[package\]\nname = "textus"\nversion = ")[^"]*(")/m,
  ],
  "src-tauri/Cargo.lock": [
    /^(\[\[package\]\]\nname = "textus"\nversion = ")[^"]*(")/m,
  ],
  "src-tauri/tauri.conf.json": [/^( {2}"version": ")[^"]*(")/m],
};

export const VERSION_FILES = Object.keys(VERSION_LINES);

/** The files whose text changes when the app becomes `version`, by path;
 *  `read(path)` gives a file's text. Throws when a file's shape is new. */
export function bumpFiles(read, version) {
  const changed = {};
  for (const [file, lines] of Object.entries(VERSION_LINES)) {
    const before = read(file);
    let text = before;
    for (const line of lines) {
      if (!line.test(text))
        throw new Error(`${file}: no version line where one was expected`);
      text = text.replace(line, `$1${version}$2`);
    }
    if (text !== before) changed[file] = text;
  }
  const versions = collectVersions((file) => changed[file] ?? read(file));
  const problems = versionProblems(versions, `v${version}`);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return changed;
}
