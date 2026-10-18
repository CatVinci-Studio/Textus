#!/usr/bin/env node
// The in-app updater's manifest, and the guard that keeps Textus releases
// away from Levis installs.
//
// Levis (com.chengaoshen.levis, 0.9.x) polls
//   github.com/CatVinci-Studio/Levis/releases/latest/download/latest.json
// and the repository rename to CatVinci-Studio/Textus redirects that URL to
// this repository. Textus is signed with the same updater key, so a
// `latest.json` on a Textus release would be downloaded, verified and
// installed over Levis.app by every Levis install. Textus therefore never
// publishes a file of that name: its manifest is `textus-latest.json`,
// written here from the draft release's signed artifacts (tauri-action runs
// with includeUpdaterJson: false).
//
// The one `latest.json` a Textus release carries is a copy of the last
// Levis release's own (LEVIS_LAST_TAG): once Textus is "Latest", a Levis
// install older than that still finds it there, updates to the last Levis
// - which tells its user about Textus - and the last Levis sees itself as
// current. The release workflow refuses to publish a draft whose
// `latest.json` is anything else: a Levis version, Levis assets on a
// v0.9.x tag, nothing that could install Textus.
//
//   node scripts/updater-manifest.mjs check [--root DIR]
//       tauri.conf.json's updater endpoints name textus-latest.json, the
//       beta channel's names textus-beta.json, and release.yml keeps
//       tauri-action from uploading latest.json (exit 1 otherwise)
//   node scripts/updater-manifest.mjs build --version V --base-url URL
//       --sig-dir DIR [--notes-file F] --out FILE
//       the manifest for the .sig files downloaded into DIR; each artifact's
//       URL is BASE-URL/<its name> (the .sig's name minus ".sig")
//   node scripts/updater-manifest.mjs beta --version V --manifest FILE
//       [--current FILE]
//       FILE is a release's textus-latest.json, to become textus-beta.json;
//       exit 1 unless it is a complete manifest of V, else print "advance"
//       when it is not older than CURRENT (the beta manifest there now,
//       none when absent) and "keep" when it is
//   node scripts/updater-manifest.mjs bridge --levis-manifest FILE
//       exit 1 unless FILE is the last Levis release's latest.json
//   node scripts/updater-manifest.mjs guard --assets-file FILE
//       [--levis-manifest FILE]
//       FILE lists a release's asset names, one per line; exit 1 if the
//       release carries latest.json and the given copy of it is not the
//       last Levis release's
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What Textus's updater reads and the release workflow uploads. */
export const MANIFEST_NAME = "textus-latest.json";
/** What Levis's updater reads. On a Textus release, only as a copy of the
 *  last Levis release's own. */
export const LEVIS_MANIFEST_NAME = "latest.json";
/** The last Levis release: the one every older Levis install updates to. */
export const LEVIS_LAST_TAG = "v0.9.8";
/** What the beta update channel reads: the newest release of any kind,
 *  release candidates included, kept on the website's download bucket
 *  (scripts/update-beta-manifest.sh) because GitHub's releases/latest
 *  skips pre-releases. Never on a GitHub release. */
export const BETA_MANIFEST_NAME = "textus-beta.json";
/** Where the app finds the beta manifest's URL. */
const BETA_ENDPOINT_SOURCE = "src-tauri/src/commands/update.rs";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Problems with the updater wiring in a checkout, one line each. */
export function configProblems(readFile) {
  const problems = [];
  const conf = JSON.parse(readFile("src-tauri/tauri.conf.json"));
  const endpoints = conf.plugins?.updater?.endpoints ?? [];
  if (endpoints.length === 0)
    problems.push("tauri.conf.json: no updater endpoints");
  for (const url of endpoints) {
    const file = url.split("/").pop();
    if (file !== MANIFEST_NAME)
      problems.push(
        `tauri.conf.json: updater endpoint ${url} must end in /${MANIFEST_NAME}`,
      );
  }
  // Tags from before the update channel have no beta endpoint to check.
  let updateRs = null;
  try {
    updateRs = readFile(BETA_ENDPOINT_SOURCE);
  } catch {
    // Not there: nothing to check.
  }
  if (updateRs !== null) {
    const url = /BETA_MANIFEST_URL: &str =\s*"([^"]+)"/.exec(updateRs)?.[1];
    if (!url?.endsWith(`/${BETA_MANIFEST_NAME}`))
      problems.push(
        `${BETA_ENDPOINT_SOURCE}: BETA_MANIFEST_URL must end in /${BETA_MANIFEST_NAME}`,
      );
  }
  const workflow = readFile(".github/workflows/release.yml");
  if (!/^\s*includeUpdaterJson:\s*false\s*$/m.test(workflow))
    problems.push(
      `release.yml: tauri-action must run with includeUpdaterJson: false (it uploads ${LEVIS_MANIFEST_NAME} otherwise)`,
    );
  return problems;
}

/** The updater platform keys an artifact serves, by its asset name. The
 *  plain `<os>-<arch>` key is the default installer for that platform;
 *  `<os>-<arch>-<installer>` lets an install that came from a .deb or .rpm
 *  stay on that format (tauri-plugin-updater tries the longer key first). */
export function platformKeys(name) {
  if (/\.app\.tar\.gz$/.test(name)) {
    if (/aarch64|arm64/.test(name))
      return ["darwin-aarch64", "darwin-aarch64-app"];
    if (/x64|x86_64/.test(name)) return ["darwin-x86_64", "darwin-x86_64-app"];
    return [];
  }
  if (/\.AppImage$/.test(name))
    return ["linux-x86_64", "linux-x86_64-appimage"];
  if (/\.deb$/.test(name)) return ["linux-x86_64-deb"];
  if (/\.rpm$/.test(name)) return ["linux-x86_64-rpm"];
  if (/-setup\.exe$/.test(name))
    return ["windows-x86_64", "windows-x86_64-nsis"];
  return [];
}

/** The manifest for `artifacts` ({ name, signature }), in the format
 *  tauri-plugin-updater reads. */
export function buildManifest({ version, notes, pubDate, baseUrl, artifacts }) {
  const platforms = {};
  for (const { name, signature } of artifacts) {
    for (const key of platformKeys(name)) {
      if (platforms[key]) throw new Error(`two artifacts serve ${key}`);
      platforms[key] = {
        signature: signature.trim(),
        url: `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(name)}`,
      };
    }
  }
  return { version, notes, pub_date: pubDate, platforms };
}

/** Platforms every release must serve. */
export const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
];

export function manifestProblems(manifest, version) {
  const problems = [];
  if (manifest.version !== version)
    problems.push(`manifest says ${manifest.version}, expected ${version}`);
  for (const key of REQUIRED_PLATFORMS) {
    const entry = manifest.platforms[key];
    if (!entry?.url || !entry?.signature)
      problems.push(`no signed ${key} entry`);
  }
  return problems;
}

/** Semver precedence of two versions such as "1.0.5" and "1.0.5-rc.2":
 *  negative, zero or positive. A pre-release sorts before its release, and
 *  numeric identifiers compare as numbers (rc.10 after rc.9). Build
 *  metadata is ignored. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m =
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        String(v),
      );
    if (!m) throw new Error(`not a version: ${v}`);
    return { core: m.slice(1, 4).map(Number), pre: m[4]?.split(".") ?? [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre.length === 0 || y.pre.length === 0)
    return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** Whether the beta manifest moves to `candidate` (a release's manifest)
 *  from `current` (what the bucket holds now; null when there is none).
 *  Never backwards: rebuilding an old tag leaves it alone. The same version
 *  does replace it, since a rebuild re-signs the release's files and the
 *  old signatures no longer match them. */
export function betaAdvances(current, candidate) {
  if (!current?.version) return true;
  return compareVersions(candidate.version, current.version) >= 0;
}

/** Why `manifest` is not the last Levis release's latest.json - empty when
 *  it is: that version, and every download a Levis asset on that tag. */
export function levisBridgeProblems(manifest) {
  const problems = [];
  const version = LEVIS_LAST_TAG.slice(1);
  if (manifest?.version !== version)
    problems.push(
      `latest.json says ${manifest?.version}, not Levis ${version}`,
    );
  const entries = Object.entries(manifest?.platforms ?? {});
  if (entries.length === 0) problems.push("latest.json has no platforms");
  for (const [key, entry] of entries) {
    const url = String(entry?.url ?? "");
    const asset = decodeURIComponent(url.split("/").pop() ?? "");
    if (!url.includes(`/releases/download/${LEVIS_LAST_TAG}/`))
      problems.push(`${key}: ${url} is not on ${LEVIS_LAST_TAG}`);
    if (!/^Levis[_-]/.test(asset) || /textus/i.test(url))
      problems.push(`${key}: ${asset} is not a Levis asset`);
  }
  return problems;
}

/** Why a release with these assets can't be published: a latest.json that
 *  is not the last Levis release's (`levisManifest`, its parsed content). */
export function forbiddenAssets(names, levisManifest) {
  if (!names.some((name) => name.trim() === LEVIS_MANIFEST_NAME)) return [];
  if (levisManifest === undefined)
    return [`${LEVIS_MANIFEST_NAME} is on the release but was not checked`];
  return levisBridgeProblems(levisManifest);
}

function fail(lines) {
  for (const line of lines) console.error(`::error::${line}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    if (!args[at + 1]) fail([`${name} needs a value`]);
    return args[at + 1];
  };
  const required = (name) => option(name) ?? fail([`${name} is required`]);

  if (command === "check") {
    const root = option("--root") ?? ownRoot;
    const problems = configProblems((file) =>
      readFileSync(join(root, file), "utf8"),
    );
    if (problems.length > 0) fail(problems);
  } else if (command === "build") {
    const version = required("--version");
    const sigDir = required("--sig-dir");
    const notesFile = option("--notes-file");
    const artifacts = readdirSync(sigDir)
      .filter((file) => file.endsWith(".sig"))
      .map((file) => ({
        name: file.slice(0, -".sig".length),
        signature: readFileSync(join(sigDir, file), "utf8"),
      }));
    const manifest = buildManifest({
      version,
      notes: notesFile ? readFileSync(notesFile, "utf8") : "",
      pubDate: new Date().toISOString(),
      baseUrl: required("--base-url"),
      artifacts,
    });
    const problems = manifestProblems(manifest, version);
    if (problems.length > 0) fail(problems);
    writeFileSync(required("--out"), `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === "beta") {
    const version = required("--version");
    const manifest = JSON.parse(readFileSync(required("--manifest"), "utf8"));
    const problems = manifestProblems(manifest, version);
    if (problems.length > 0) fail(problems);
    const currentFile = option("--current");
    const current = currentFile
      ? JSON.parse(readFileSync(currentFile, "utf8"))
      : null;
    console.log(betaAdvances(current, manifest) ? "advance" : "keep");
  } else if (command === "bridge") {
    const manifest = JSON.parse(
      readFileSync(required("--levis-manifest"), "utf8"),
    );
    const problems = levisBridgeProblems(manifest);
    if (problems.length > 0) fail(problems);
  } else if (command === "guard") {
    const names = readFileSync(required("--assets-file"), "utf8").split("\n");
    const file = option("--levis-manifest");
    const bad = forbiddenAssets(
      names,
      file ? JSON.parse(readFileSync(file, "utf8")) : undefined,
    );
    if (bad.length > 0)
      fail([
        `this release's ${LEVIS_MANIFEST_NAME} is not ${LEVIS_LAST_TAG}'s: every Levis install reads it and could install Textus over itself.`,
        ...bad,
      ]);
  } else {
    fail([
      `unknown command ${command ?? "(none)"}: check, build, beta, bridge or guard`,
    ]);
  }
}
