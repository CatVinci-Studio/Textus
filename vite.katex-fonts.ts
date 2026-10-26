import type { Plugin } from "vite";

/**
 * Trims KaTeX's @font-face src lists to woff2 before Vite resolves them:
 * every webview takes woff2 first, so woff and ttf were ~800 KB never loaded.
 */
export function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css(\?|$)/.test(id)) return;
      return { code: keepWoff2Sources(code), map: null };
    },
  };
}

/** Drops every non-woff2 entry from the `src:` lists of the @font-face rules
 *  in `css`. A list without a woff2 entry is left whole rather than emptied. */
export function keepWoff2Sources(css: string): string {
  return css.replace(
    /(@font-face\s*\{[^}]*?\bsrc\s*:\s*)([^;}]+)/g,
    (rule, head: string, list: string) => {
      const woff2 = list
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => /format\(\s*["']?woff2["']?\s*\)/.test(entry));
      return woff2.length > 0 ? head + woff2.join(",") : rule;
    },
  );
}
