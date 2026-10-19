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
// with uploadUpdaterJson: false - `includeUpdaterJson` before tauri-action 1.0).
//
// Releases up to 1.1.0 carried one `latest.json`: a copy of the last Levis
// release's (v0.9.8), so a Levis install updated to that Levis, which told
// its user about Textus. Levis support ended after 1.1.0, and later releases
// carry no copy: once one of them is "Latest", a Levis install finds no
// manifest and so no update. A `latest.json` on a release is now always an
// error, and the release workflow refuses to publish one.
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
//   node scripts/updater-manifest.mjs guard --assets-file FILE
//       FILE lists a release's asset names, one per line; exit 1 if the
//       release carries latest.json
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What Textus's updater reads and the release workflow uploads. */
export const MANIFEST_NAME = "textus-latest.json";
/** What Levis's updater reads. Never on a Textus release. */
export const LEVIS_MANIFEST_NAME = "latest.json";
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
  // tauri-action 1.0 renamed the input, and an unknown input is ignored
  // without a word: with the old name on v1 it would upload latest.json.
  // Tags from before 1.0 still pin v0 and use the old name.
  const major = Number(
    workflow.match(/tauri-apps\/tauri-action@\S+\s*#\s*v(\d+)/)?.[1] ?? NaN,
  );
  const input = major >= 1 ? "uploadUpdaterJson" : "includeUpdaterJson";
  if (Number.isNaN(major))
    problems.push(
      "release.yml: pin tauri-action to a commit with its version in a comment (`@<sha> # vX.Y.Z`)",
    );
  else if (!new RegExp(`^\\s*${input}:\\s*false\\s*$`, "m").test(workflow))
    problems.push(
      `release.yml: tauri-action v${major} must run with ${input}: false (it uploads ${LEVIS_MANIFEST_NAME} otherwise)`,
    );
  return problems;
}

/** The updater's name (tauri-plugin-updater's `{arch}`: x86_64 or
 *  aarch64) for the architecture in an artifact's name, which
 *  tauri-bundler spells per format: `_x64`/`_aarch64` on the macOS
 *  .app.tar.gz, `_x64`/`_arm64` on the -setup.exe, `_amd64`/`_arm64` on
 *  the .deb, `.x86_64`/`.aarch64` on the .rpm, `_amd64`/`_aarch64` on the
 *  AppImage. */
function artifactArch(name) {
  if (/[_.](x64|amd64|x86_64)[-_.]/.test(name)) return "x86_64";
  if (/[_.](arm64|aarch64)[-_.]/.test(name)) return "aarch64";
  return null;
}

/** The updater platform keys an artifact serves, by its asset name. The
 *  plain `<os>-<arch>` key is the default installer for that platform;
 *  `<os>-<arch>-<installer>` lets an install that came from a .deb or .rpm
 *  stay on that format (tauri-plugin-updater tries the longer key first). */
export function platformKeys(name) {
  const arch = artifactArch(name);
  if (arch === null) return [];
  if (/\.app\.tar\.gz$/.test(name))
    return [`darwin-${arch}`, `darwin-${arch}-app`];
  if (/\.AppImage$/.test(name))
    return [`linux-${arch}`, `linux-${arch}-appimage`];
  if (/\.deb$/.test(name)) return [`linux-${arch}-deb`];
  if (/\.rpm$/.test(name)) return [`linux-${arch}-rpm`];
  if (/-setup\.exe$/.test(name))
    return [`windows-${arch}`, `windows-${arch}-nsis`];
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

/** Platforms every release must serve. ARM64 Windows and Linux since
 *  1.1.0-rc.5; a rebuild of an older tag builds them too, since the build
 *  matrix comes from the workflow's ref. A manifest published before then
 *  lacks them, so `beta` refuses it. */
export const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-aarch64",
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

/** Why a release with these assets can't be published: it carries
 *  latest.json, which every Levis install would read and install. */
export function forbiddenAssets(names) {
  return names.some((name) => name.trim() === LEVIS_MANIFEST_NAME)
    ? [`${LEVIS_MANIFEST_NAME} is on the release`]
    : [];
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
  } else if (command === "guard") {
    const names = readFileSync(required("--assets-file"), "utf8").split("\n");
    const bad = forbiddenAssets(names);
    if (bad.length > 0)
      fail([
        ...bad,
        `every Levis install reads ${LEVIS_MANIFEST_NAME} from this repository and trusts the same signing key, so it would install Textus over itself. Delete the asset from the draft and run the job again.`,
      ]);
  } else {
    fail([
      `unknown command ${command ?? "(none)"}: check, build, beta or guard`,
    ]);
  }
}
