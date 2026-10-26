#!/usr/bin/env node
// The in-app updater's manifest, and the guard that keeps Textus releases
// away from Levis installs: Levis polls `latest.json` through the renamed
// repository and trusts the same key, so a Textus release never carries one.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What Textus's updater reads and the release workflow uploads. */
export const MANIFEST_NAME = "textus-latest.json";
/** What Levis's updater reads. Never on a Textus release. */
export const LEVIS_MANIFEST_NAME = "latest.json";
/** What the beta channel reads: the newest release of any kind, kept on the
 *  download bucket since GitHub's releases/latest skips pre-releases. */
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
  // tauri-action 1.0 renamed the input and silently ignores the old one,
  // which would then upload latest.json; older tags pin v0.
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

/** The updater's `{arch}` (x86_64 or aarch64) for an artifact's name, which
 *  tauri-bundler spells differently per format. */
function artifactArch(name) {
  if (/[_.](x64|amd64|x86_64)[-_.]/.test(name)) return "x86_64";
  if (/[_.](arm64|aarch64)[-_.]/.test(name)) return "aarch64";
  return null;
}

/** The updater platform keys an artifact serves. `<os>-<arch>-<installer>`
 *  keeps a .deb or .rpm install on its format; the updater tries it first. */
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

/** Platforms every release must serve; `beta` refuses a manifest lacking
 *  any. */
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

/** Semver precedence of two versions: negative, zero or positive. Build
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

/** Whether the beta manifest moves from `current` (or null) to `candidate`.
 *  Never backwards; the same version replaces it, since a rebuild re-signs. */
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
