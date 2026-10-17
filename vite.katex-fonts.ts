import type { Plugin } from "vite";

/**
 * KaTeX's stylesheet lists every font three times - woff2, woff, ttf - and
 * Vite emits every file a url() names, so the app and the playground shipped
 * ~800 KB of woff/ttf that no webview ever loads: WKWebView, WebView2 and
 * WebKitGTK (and the Chromium the e2e flows run in) all take the woff2 first.
 * This trims each @font-face src list in KaTeX's CSS to its woff2 entry
 * before Vite resolves the urls, so the other two are never bundled.
 * Exports inline the page's CSS rules (src/export/exporters.ts), which
 * carry the same woff2 urls the editor already used.
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
