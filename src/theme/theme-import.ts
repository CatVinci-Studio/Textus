import { fs, themes } from "../platform/ipc";
import type { UserThemeMeta } from "../prefs/SettingsContext";

/// Typora themes often `@import` a sibling stylesheet and use relative
/// `url(...)` assets, neither of which resolves in a runtime `<style>`. So
/// imports are inlined recursively and local assets embedded as data URIs.

const IMPORT_RE =
  /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*;/g;
const URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

const MIME_BY_EXT: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function isRemoteOrData(target: string): boolean {
  return /^([a-z]+:)?\/\//i.test(target) || target.startsWith("data:");
}

function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx) : "";
}

// baseDir is an OS path with either separator; rel comes from CSS, so "/".
// Windows APIs accept "/" too.
function resolvePath(baseDir: string, rel: string): string {
  const stack = baseDir ? baseDir.split(/[\\/]/) : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function guessMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function inlineLocalUrls(css: string, baseDir: string): Promise<string> {
  const matches = [...css.matchAll(URL_RE)];
  let result = "";
  let lastIndex = 0;
  for (const m of matches) {
    const target = m[1];
    const start = m.index ?? 0;
    result += css.slice(lastIndex, start);
    lastIndex = start + m[0].length;

    if (!target || isRemoteOrData(target)) {
      result += m[0];
      continue;
    }
    try {
      const resolved = resolvePath(baseDir, target);
      const base64 = await fs.readBinaryFileBase64(resolved);
      result += `url("data:${guessMime(resolved)};base64,${base64}")`;
    } catch {
      result += m[0]; // asset missing/unreadable - leave the original reference (best effort)
    }
  }
  result += css.slice(lastIndex);
  return result;
}

async function inlineFile(path: string, seen: Set<string>): Promise<string> {
  if (seen.has(path)) return ""; // circular @import guard
  seen.add(path);

  const raw = await fs.readTextFile(path);
  const baseDir = dirnameOf(path);

  let withImports = "";
  let lastIndex = 0;
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(raw))) {
    const target = m[1] ?? m[2];
    withImports += raw.slice(lastIndex, m.index);
    lastIndex = IMPORT_RE.lastIndex;

    if (!target || isRemoteOrData(target)) {
      withImports += m[0];
      continue;
    }
    withImports += await inlineFile(resolvePath(baseDir, target), seen);
  }
  withImports += raw.slice(lastIndex);

  return inlineLocalUrls(withImports, baseDir);
}

/// Reads a theme CSS file as one self-contained stylesheet.
export async function importThemeCss(path: string): Promise<string> {
  return inlineFile(path, new Set());
}

/// Saves a self-contained stylesheet as a user theme, new or over `replacing`
/// (a gallery update), and returns its settings entry.
export async function saveUserTheme(
  css: string,
  meta: Omit<UserThemeMeta, "id" | "hasDark">,
  replacing?: string,
): Promise<UserThemeMeta> {
  const id = replacing ?? `user-${crypto.randomUUID()}`;
  await themes.saveThemeCss(id, "light", css);
  return { ...meta, id, hasDark: false };
}

/// `userThemes` with `meta` in it: in its old place when it replaces a
/// theme, at the end when it is new.
export function withUserTheme(
  list: UserThemeMeta[],
  meta: UserThemeMeta,
): UserThemeMeta[] {
  return list.some((th) => th.id === meta.id)
    ? list.map((th) => (th.id === meta.id ? meta : th))
    : [...list, meta];
}
