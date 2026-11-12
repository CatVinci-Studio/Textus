import IMAGE_TYPES from "../editor/images/image-types.json";
import { fs, themes } from "../platform/ipc";
import { IMPORT_RE, withWebFonts } from "./web-fonts";
import { isInside } from "../utils/path";
import type { UserThemeMeta } from "../prefs/SettingsContext";

/// Typora themes often `@import` a sibling stylesheet and use relative
/// `url(...)` assets, neither of which resolves in a runtime `<style>`. So
/// imports are inlined recursively and local assets embedded as data URIs.

const URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

const MIME_BY_EXT: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  ...IMAGE_TYPES,
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

/** A font or picture's type by its extension; null for anything else. */
function mimeOf(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
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
    const resolved = resolvePath(baseDir, target);
    const mime = mimeOf(resolved);
    // Only the theme's own fonts and pictures, beside it: a url() naming
    // any other file is left as written, not copied into the theme.
    if (!mime || !isInside(resolved, baseDir)) {
      result += m[0];
      continue;
    }
    try {
      const base64 = await fs.readBinaryFileBase64(resolved);
      result += `url("data:${mime};base64,${base64}")`;
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
  // matchAll reads its own copy: an import inlined meanwhile can't move
  // this loop's place.
  for (const m of raw.matchAll(IMPORT_RE)) {
    const target = m[1] ?? m[2];
    withImports += raw.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;

    if (!target || isRemoteOrData(target)) {
      withImports += m[0];
      continue;
    }
    const text = await inlineFile(resolvePath(baseDir, target), seen);
    // `@import "x.css" print;`: the sheet for those media only.
    const media = m[3].trim();
    withImports += media ? `@media ${media} {\n${text}\n}` : text;
  }
  withImports += raw.slice(lastIndex);

  return inlineLocalUrls(withImports, baseDir);
}

/// Reads a theme CSS file as one self-contained stylesheet.
export async function importThemeCss(path: string): Promise<string> {
  return withWebFonts(await inlineFile(path, new Set()));
}

/// Saves a self-contained stylesheet as a user theme, new or over `replacing`
/// (a gallery update), with its dark form when it has one, and returns its
/// settings entry.
export async function saveUserTheme(
  css: string,
  meta: Omit<UserThemeMeta, "id" | "hasDark">,
  replacing?: string,
  darkCss?: string,
): Promise<UserThemeMeta> {
  const id = replacing ?? `user-${crypto.randomUUID()}`;
  await themes.saveThemeCss(id, "light", css);
  if (darkCss) await themes.saveThemeCss(id, "dark", darkCss);
  return { ...meta, id, hasDark: !!darkCss };
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
