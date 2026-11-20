import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/** The file Settings › About opens (src/help/licenses.ts). */
export const LICENSES_FILE = "open-source-licenses.md";

// The licenses of everything third-party that ships inside Textus, written
// into the build as third-party-notices.md (Settings › About › Open-source
// licenses). npm packages are the ones the bundle really holds; Rust crates
// are the ones compiled for the platform Tauri builds for.

export interface ThirdParty {
  name: string;
  version: string;
  /** The SPDX expression the package declares. */
  license: string;
  url?: string;
  /** Its own license files' texts, if it ships any. */
  texts: string[];
  /** Its NOTICE files' texts (Apache-2.0 asks for them to travel along). */
  notices: string[];
  /** Who holds the copyright, when no license file names them. */
  authors?: string[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|unlicense)([-._].*)?$/i;
// Machine-readable license metadata, not a license text.
const METADATA_FILE = /\.(spdx|json|toml)$/i;
const NOTICE_FILE = /^notice([-._].*)?$/i;
const COPYRIGHT_LINE = /^\s*(copyright\b|\(c\)|©)/i;
// Of the licenses a package offers ("MIT OR Apache-2.0"), the one taken.
const PREFERRED = [
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Zlib",
  "Apache-2.0",
  "Unlicense",
  "CC0-1.0",
  "BSL-1.0",
  "Unicode-3.0",
  "MPL-2.0",
];
/** Licenses that would bind Textus's own code: a build never ships them. */
const REFUSED = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC)/i;

/** The npm package directory a bundled module comes from. */
export function packageDirOf(id: string): string | null {
  const clean = id.replace(/^\0/, "").split("?")[0];
  // Vite's module ids use "/" on every system.
  const at = clean.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = clean.slice(at + 14).split("/");
  const parts = rest[0].startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
  return clean.slice(0, at + 14) + parts.join("/");
}

/** The licenses taken from an SPDX expression: one of each OR, all of an
 *  AND. Exceptions ("WITH LLVM-exception") stay with their license. */
export function chosenLicenses(expression: string): string[] {
  const expr = expression.replace(/[()]/g, " ").replace(/\//g, " OR ").trim();
  return expr.split(/\s+AND\s+/i).map((part) => {
    const options = part.split(/\s+OR\s+/i).map((o) => o.trim());
    const base = (o: string) => o.split(/\s+WITH\s+/i)[0];
    return (
      PREFERRED.map((p) => options.find((o) => base(o) === p)).find(Boolean) ??
      options[0]
    );
  });
}

/** A license text without its copyright lines, and those lines. */
export function splitCopyright(text: string): {
  body: string;
  copyright: string[];
} {
  const copyright: string[] = [];
  const body: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (COPYRIGHT_LINE.test(line)) copyright.push(line.trim());
    else body.push(line);
  }
  return { body: body.join("\n").trim(), copyright };
}

/** Reads a package directory's license and NOTICE files. */
export function filesIn(dir: string): { texts: string[]; notices: string[] } {
  const texts: string[] = [];
  const notices: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return { texts, notices };
  }
  for (const name of names) {
    if (METADATA_FILE.test(name)) continue;
    const into = LICENSE_FILE.test(name)
      ? texts
      : NOTICE_FILE.test(name)
        ? notices
        : null;
    if (!into) continue;
    try {
      into.push(readFileSync(join(dir, name), "utf8"));
    } catch {
      // A directory named LICENSES/, read as no file.
    }
  }
  return { texts, notices };
}

function npmPackage(dir: string): ThirdParty | null {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!pkg.name) return null;
  const repo =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  return {
    name: pkg.name,
    version: pkg.version,
    license:
      pkg.license ??
      pkg.licenses?.map((l: { type: string }) => l.type).join(" OR ") ??
      "",
    url: pkg.homepage ?? repo?.replace(/^git\+/, "").replace(/\.git$/, ""),
    authors: author ? [author] : undefined,
    ...filesIn(dir),
  };
}

interface CargoMeta {
  packages: {
    id: string;
    name: string;
    version: string;
    license: string | null;
    license_file: string | null;
    repository: string | null;
    authors: string[];
    manifest_path: string;
    targets: { kind: string[] }[];
  }[];
  workspace_members: string[];
  resolve: {
    root: string;
    nodes: {
      id: string;
      deps: { pkg: string; dep_kinds: { kind: string | null }[] }[];
    }[];
  };
}

/** The crates compiled into the app for `triple`: normal dependencies of
 *  the app, without build scripts' and proc macros' (they only run while
 *  building) or the workspace's own. */
export function shippedCrates(meta: CargoMeta): ThirdParty[] {
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const own = new Set(meta.workspace_members);
  const seen = new Set<string>();
  const stack = [meta.resolve.root];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
      const crate = packages.get(dep.pkg);
      if (crate?.targets.some((t) => t.kind.includes("proc-macro"))) continue;
      stack.push(dep.pkg);
    }
  }
  return [...seen]
    .filter((id) => !own.has(id))
    .map((id) => packages.get(id)!)
    .map((p) => {
      const dir = dirname(p.manifest_path);
      const files = filesIn(dir);
      if (p.license_file && !files.texts.length)
        files.texts.push(readFileSync(join(dir, p.license_file), "utf8"));
      return {
        name: p.name,
        version: p.version,
        license: p.license ?? (p.license_file ? "SEE LICENSE FILE" : ""),
        url: p.repository ?? undefined,
        authors: p.authors.length ? p.authors : undefined,
        ...files,
      };
    });
}

function cargoMetadata(triple: string): CargoMeta {
  const args = [
    "metadata",
    "--format-version",
    "1",
    "--locked",
    "--filter-platform",
    triple,
    "--manifest-path",
    "src-tauri/Cargo.toml",
  ];
  const run = (extra: string[]) =>
    execFileSync("cargo", [...args, ...extra], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  let out: string;
  try {
    out = run(["--offline"]);
  } catch {
    out = run([]);
  }
  return JSON.parse(out);
}

type Standard = (id: string) => string | undefined;

function spdxText(): Standard {
  const list = createRequire(import.meta.url)(
    "spdx-license-list/full.js",
  ) as Record<string, { licenseText: string }>;
  return (id) => list[id]?.licenseText;
}

/** One package's license texts: its own files, or the standard text of
 *  what it declares when it ships none. */
function textsOf(p: ThirdParty, standard: Standard): string[] {
  if (p.texts.length) {
    // A dual-licensed crate ships both texts; the one taken is enough.
    const taken = chosenLicenses(p.license);
    if (p.texts.length > 1 && taken.length === 1) {
      const id = taken[0].split(/\s+WITH\s+/i)[0];
      const marker =
        id === "Apache-2.0"
          ? /apache license/i
          : new RegExp(id.split("-")[0], "i");
      const match = p.texts.find((t) => marker.test(t.slice(0, 400)));
      if (match) return [match];
    }
    return p.texts;
  }
  return chosenLicenses(p.license).map((id) => {
    const text = standard(id.split(/\s+WITH\s+/i)[0]);
    if (!text)
      throw new Error(
        `${p.name} ${p.version}: no license file and no standard text for "${p.license}"`,
      );
    return text;
  });
}

/** The notices document: the hand-copied code first, then every package,
 *  grouped by license text (copyright lines kept per package). */
export function noticesMarkdown(
  packages: ThirdParty[],
  handCopied: string,
  standard: Standard = spdxText(),
): string {
  for (const p of packages)
    if (!p.license && p.texts.length) p.license = "see its license file";
  const problems = packages
    .filter(
      (p) => !p.license || REFUSED.test(chosenLicenses(p.license).join(" ")),
    )
    .map((p) => `${p.name} ${p.version} (${p.license || "no license"})`);
  if (problems.length)
    throw new Error(
      `Third-party code without a usable license: ${problems.join(", ")}`,
    );

  const groups = new Map<string, { body: string; rows: string[] }>();
  const notices: string[] = [];
  const sorted = [...packages].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const seen = new Set<string>();
  for (const p of sorted) {
    const key = `${p.name}@${p.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const text of textsOf(p, standard)) {
      const { body, copyright } = splitCopyright(text);
      const hash = createHash("sha256").update(body).digest("hex");
      const group = groups.get(hash) ?? { body, rows: [] };
      const holders = copyright.length
        ? copyright.join("; ")
        : p.authors?.length
          ? `Copyright (c) ${p.authors.join(", ")}`
          : "";
      const link = p.url ? ` - ${p.url}` : "";
      group.rows.push(
        `- ${p.name} ${p.version} (${p.license})${link}${holders ? `  \n  ${holders}` : ""}`,
      );
      groups.set(hash, group);
    }
    for (const notice of p.notices)
      notices.push(
        `### ${p.name} ${p.version}\n\n\`\`\`text\n${notice.trim()}\n\`\`\``,
      );
  }

  const sections = [...groups.values()]
    .sort((a, b) => b.rows.length - a.rows.length)
    .map(
      (g, i) =>
        `### License text ${i + 1}\n\nUsed by:\n\n${g.rows.join("\n")}\n\n\`\`\`text\n${g.body}\n\`\`\``,
    );
  return (
    [
      "# Open-source licenses",
      "Textus is made by CatVinci Studio and the Textus contributors and released under the MIT License. It includes the open-source software below; each keeps its own license, and the copyright lines are its authors'.",
      handCopied
        .replace(/^# .*\n+/, "")
        .replace(/^Code and artwork.*\n+/m, "")
        .trim(),
      `## Packages (${seen.size})`,
      ...sections,
      ...(notices.length ? ["## NOTICE files", ...notices] : []),
    ].join("\n\n") + "\n"
  );
}

/** Writes the notices into the build. Tauri's builds add the Rust crates;
 *  a build for the web (tests, the playground) has only the npm side. */
export function thirdPartyNotices(): Plugin {
  return {
    name: "textus-third-party-notices",
    apply: "build",
    generateBundle() {
      const dirs = new Set<string>();
      for (const id of this.getModuleIds()) {
        const dir = packageDirOf(id);
        if (dir && existsSync(join(dir, "package.json"))) dirs.add(dir);
      }
      const packages = [...dirs].map(npmPackage).filter((p) => p !== null);
      const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
      if (triple) packages.push(...shippedCrates(cargoMetadata(triple)));
      const handCopied = readFileSync("THIRD-PARTY-NOTICES.md", "utf8");
      this.emitFile({
        type: "asset",
        fileName: LICENSES_FILE,
        source: noticesMarkdown(packages, handCopied),
      });
    },
  };
}
