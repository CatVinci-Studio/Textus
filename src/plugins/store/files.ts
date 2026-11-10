import { plugins as pluginsIpc } from "../../platform/ipc";
import { pluginFilesBase } from "../../platform/file-src";
import { scaleStylesheet } from "../../engine/tokens/scale-lengths";

/**
 * A plugin's own files, and how a webview gets them: each
 * `textus-resource:` becomes a `textus-plugin:` URL of that file
 * (plugins/scheme.rs), or a `data:` URL where there is no such scheme.
 */

/** Where a plugin's files are: installed (from the catalog or a file),
 *  or a developer's folder. None comes with the app. */
export type PluginOrigin = "installed" | "dev";

/** A relative path inside the plugin, or an error: no `..`, no root. */
export function pluginPath(rel: string): string {
  const parts = rel
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .split("/");
  if (
    !rel ||
    parts.some((p) => p === ".." || p === "") ||
    /^[a-z]+:/i.test(rel)
  )
    throw new Error(`"${rel}" is not a file of the plugin.`);
  return parts.join("/");
}

export async function readPluginFile(
  id: string,
  // Both are on disk; kept for the callers, which say where it is from.
  _origin: PluginOrigin,
  rel: string,
): Promise<Uint8Array> {
  return pluginsIpc.file(id, pluginPath(rel));
}

const MIME: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  html: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
  bcmap: "application/octet-stream",
};

export function mimeOf(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function dataUrl(path: string, bytes: Uint8Array): string {
  return `data:${mimeOf(path)};base64,${toBase64(bytes)}`;
}

const RESOURCE = /textus-resource:([A-Za-z0-9._~\-/]+)/g;

/** `html` with each `textus-resource:<path>` replaced by the URL of that
 *  file of plugin `id`'s. A big file as a `data:` URL took WebKit gigabytes
 *  to load, so it is one only where nothing serves the files. */
export async function withResources(
  html: string,
  id: string,
  read: (rel: string) => Promise<Uint8Array>,
): Promise<string> {
  html = await withScaledStyles(html, read);
  const base = pluginFilesBase();
  if (base)
    return html.replace(
      RESOURCE,
      (_, rel: string) =>
        `${base}${encodeURIComponent(id)}/${rel.split("/").map(encodeURIComponent).join("/")}`,
    );
  const paths = [...new Set([...html.matchAll(RESOURCE)].map((m) => m[1]))];
  const urls = new Map<string, string>();
  await Promise.all(
    paths.map(async (rel) => {
      urls.set(rel, dataUrl(rel, await read(rel)));
    }),
  );
  return html.replace(RESOURCE, (_, rel: string) => urls.get(rel) ?? "");
}

const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const SHEET =
  /<link\b(?=[^>]*\brel=["']?stylesheet\b)[^>]*\bhref=["']?textus-resource:([A-Za-z0-9._~\-/]+)["']?[^>]*>/gi;
/** A url() in a stylesheet, unless it names a scheme, the root or data. */
const RELATIVE_URL =
  /url\(\s*(["']?)(?![a-z][a-z0-9+.-]*:|\/|#)([^"')]+)\1\s*\)/gi;

/** `html` with its stylesheets' lengths in interface pixels, as the app's
 *  own are (design-language.md 5.6): its `<style>`s, and its own sheets
 *  brought in as `<style>`s, their url()s still pointing at its files. */
async function withScaledStyles(
  html: string,
  read: (rel: string) => Promise<Uint8Array>,
): Promise<string> {
  const sheets = [...new Set([...html.matchAll(SHEET)].map((m) => m[1]))];
  const texts = new Map<string, string>();
  await Promise.all(
    sheets.map(async (rel) => {
      const dir = rel.includes("/")
        ? rel.slice(0, rel.lastIndexOf("/") + 1)
        : "";
      const css = new TextDecoder().decode(await read(pluginPath(rel)));
      texts.set(
        rel,
        css.replace(
          RELATIVE_URL,
          (_, quote: string, path: string) =>
            `url(${quote}textus-resource:${dir}${path.replace(/^\.\//, "")}${quote})`,
        ),
      );
    }),
  );
  return html
    .replace(
      STYLE,
      (_, open: string, css: string, close: string) =>
        open + scaleStylesheet(css) + close,
    )
    .replace(
      SHEET,
      (_, rel: string) =>
        `<style>${scaleStylesheet(texts.get(rel) ?? "")}</style>`,
    );
}
