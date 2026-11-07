import { webAssets } from "../platform/ipc";

/** A theme's or the user's CSS with its web fonts embedded: the window may
 *  not load fonts or stylesheets from the web itself, so a remote `@import`
 *  is replaced by its text, and every web font a `@font-face` names by a
 *  data URL, both fetched by Rust. What can't be fetched stays as written. */

const REMOTE = /^(https?:)?\/\//i;
const IMPORT_RE =
  /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])([^;]*);/g;
const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/g;
const URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
/** An imported sheet may import another; a chain this deep is a loop. */
const MAX_DEPTH = 3;

const done = new Map<string, Promise<string>>();

export function withWebFonts(css: string): Promise<string> {
  if (!/(https?:)?\/\//i.test(css)) return Promise.resolve(css);
  let pending = done.get(css);
  if (!pending) {
    pending = resolve(css, null, 0);
    done.set(css, pending);
  }
  return pending;
}

/** `target` as an absolute web address, from the sheet at `base`. */
function absolute(target: string, base: string | null): string | null {
  try {
    if (REMOTE.test(target))
      return new URL(target, "https://localhost").toString();
    return base ? new URL(target, base).toString() : null;
  } catch {
    return null;
  }
}

async function resolve(
  css: string,
  base: string | null,
  depth: number,
): Promise<string> {
  const imported = await replaceAsync(
    css,
    IMPORT_RE,
    async (
      whole,
      urlForm: string | undefined,
      plain: string | undefined,
      media: string,
    ) => {
      const href = absolute((urlForm ?? plain ?? "").trim(), base);
      if (!href || depth >= MAX_DEPTH) return whole;
      try {
        const text = await resolve(
          await webAssets.get(href, "stylesheet"),
          href,
          depth + 1,
        );
        const condition = media.trim();
        return condition ? `@media ${condition} {\n${text}\n}` : text;
      } catch {
        return whole;
      }
    },
  );
  return replaceAsync(imported, FONT_FACE_RE, (face) =>
    replaceAsync(face, URL_RE, async (whole, target: string) => {
      const href = absolute(target.trim(), base);
      if (!href) return whole;
      try {
        return `url("${await webAssets.get(href, "font")}")`;
      } catch {
        return whole;
      }
    }),
  );
}

async function replaceAsync(
  text: string,
  pattern: RegExp,
  replace: (match: string, ...groups: never[]) => Promise<string>,
): Promise<string> {
  const matches = [...text.matchAll(pattern)];
  const replaced = await Promise.all(
    matches.map((m) => replace(m[0], ...(m.slice(1) as never[]))),
  );
  let result = "";
  let last = 0;
  matches.forEach((m, i) => {
    result += text.slice(last, m.index) + replaced[i];
    last = (m.index ?? 0) + m[0].length;
  });
  return result + text.slice(last);
}
