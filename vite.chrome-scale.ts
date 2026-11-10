import type { Plugin } from "postcss";

/**
 * One size for the whole interface: every length in its stylesheets grows
 * with `--chrome-scale` (Interface Text Size times the window's width step,
 * src/engine/tokens/window-scale.ts), so a control, its icon, its padding and its
 * corner grow together instead of a few of them. The document's own
 * typography is left alone: it has its zoom.
 */

/** Stylesheets of the document's content, which follow the document's zoom. */
const DOCUMENT = [
  /\/theme\/content-[^/]+\.css$/,
  /\/editor\/milkdown-theme\.css$/,
  /\/app\/editor-column\.css$/,
  /\/editor\/modes\/source-editor\.css$/,
  /\/editor\/embeds\/note-embed\.css$/,
  /\/editor\/diagram-zoom\.css$/,
  /\/document-view\/plugins\/plugin-code-blocks\.css$/,
  /\/export\/print\.css$/,
  /\/playground\//,
];

/** A length worth scaling: 3px and up; hairlines stay crisp. Plugin pages
 *  are scaled by src/engine/tokens/scale-lengths.ts: keep the two in step. */
const LENGTH = /(^|[\s(,/+*])(-?\d*\.?\d+)px\b/g;
const SCALED = /--(chrome-scale|ui-text-scale|window-scale)\b/;

/** `value` with each length of 3px or more times the chrome's scale. */
export function scaleLengths(value: string): string {
  if (SCALED.test(value)) return value;
  return value.replace(LENGTH, (whole, before: string, n: string) =>
    Math.abs(Number(n)) < 3 || Math.abs(Number(n)) >= 999
      ? whole
      : `${before}calc(${n}px * var(--chrome-scale, 1))`,
  );
}

export function isDocumentSheet(file: string | undefined): boolean {
  const path = (file ?? "").replace(/\\/g, "/");
  return DOCUMENT.some((re) => re.test(path));
}

/** The PostCSS plugin; the app's own stylesheets only (src/). */
export function chromeScale(): Plugin {
  return {
    postcssPlugin: "chrome-scale",
    Once(root) {
      // Each declaration by the sheet it was written in: an @import brings
      // the document's own sheets into the app's.
      root.walkDecls((decl) => {
        const file = (
          decl.source?.input.file ??
          root.source?.input.file ??
          ""
        ).replace(/\\/g, "/");
        if (!file.includes("/src/") || isDocumentSheet(file)) return;
        decl.value = scaleLengths(decl.value);
      });
    },
  };
}
