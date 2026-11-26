/**
 * Installed fonts, and the chosen text font served from its files when the
 * web view can't find it by name: WKWebView was seen not to find the fonts
 * in ~/Library/Fonts, though fontdb lists them.
 */

import type { FontFamily } from "../platform/bindings/app";
import { systemIpc } from "../platform/ipc";
import { fileSrc } from "../platform/file-src";

export const SUPPLIED_FONT_STYLE_ID = "textus-supplied-font";

/** Whether `family` draws `sample` itself: its width differs from both
 *  generic fallbacks' when it does. */
export function draws(
  context: CanvasRenderingContext2D,
  family: string,
  sample: string,
): boolean {
  return ["monospace", "serif"].some((fallback) => {
    context.font = `32px ${fallback}`;
    const alone = context.measureText(sample).width;
    context.font = `32px "${family.replace(/"/g, "")}", ${fallback}`;
    return context.measureText(sample).width !== alone;
  });
}

let families: Promise<FontFamily[]> | null = null;
/** Read once per session: the list is a few hundred names and rarely
 *  changes while Textus runs. Shape from Rust's commands/fonts.rs. */
export function fontFamilies(): Promise<FontFamily[]> {
  // Without the native side (the browser build) there is no list.
  families ??= systemIpc
    .fontFamilies()
    .then((list) => (Array.isArray(list) ? list : []))
    .catch(() => []);
  return families;
}

/** One `@font-face` per file of `family`, under the name it is set by. */
export function fontFaceCss(name: string, family: FontFamily): string {
  return family.files
    .map(
      (file) =>
        `@font-face { font-family: ${JSON.stringify(name)}; ` +
        `src: url(${JSON.stringify(fileSrc(file.path))}); ` +
        `font-weight: ${file.weight}; ` +
        `font-style: ${file.italic ? "italic" : "normal"}; }`,
    )
    .join("\n");
}

const findFamily = (list: readonly FontFamily[], name: string) =>
  list.find((f) => f.name === name || f.local.some((l) => l.name === name));

/** Whether an `@font-face` in the page serves `name` already: it draws
 *  then, though only from the files that face names. */
function servedHere(name: string): boolean {
  if (!("fonts" in document)) return false;
  let found = false;
  document.fonts.forEach((face) => {
    if (face.family.replace(/^["']|["']$/g, "") === name) found = true;
  });
  return found;
}

/** The `@font-face` rules a theme carries for those of `names` the web
 *  view draws only from their files, so it shows them wherever it goes. */
export async function themeFontFaces(
  names: readonly string[],
): Promise<string> {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return "";
  const wanted = [...new Set(names)].filter(
    (name) =>
      name && (servedHere(name) || !draws(context, name, "Handgloves 0123")),
  );
  if (!wanted.length) return "";
  const list = await fontFamilies();
  return wanted
    .map((name) => {
      const family = findFamily(list, name);
      return family ? fontFaceCss(name, family) : "";
    })
    .filter(Boolean)
    .join("\n");
}

let latest = "";
let served = "";
/** Serves `name` from its files when the web view can't draw it by name;
 *  removes what an earlier choice served otherwise. */
export async function supplyFont(name: string): Promise<void> {
  latest = name;
  // Once served, the name draws: measuring again would take it away.
  if (name === served) return;
  const context = document.createElement("canvas").getContext("2d");
  let css = "";
  if (name && context && !draws(context, name, "Handgloves 0123")) {
    const list = await fontFamilies();
    if (latest !== name) return;
    const family = findFamily(list, name);
    if (family) css = fontFaceCss(name, family);
  }
  served = css ? name : "";
  let style = document.getElementById(SUPPLIED_FONT_STYLE_ID);
  if (!css) return style?.remove();
  if (!style) {
    style = document.createElement("style");
    style.id = SUPPLIED_FONT_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}
