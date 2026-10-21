import { plugins as pluginsIpc } from "../platform/ipc";

/**
 * A plugin's own files - its code, its webviews' scripts, styles and
 * images - and how a webview gets them: no URL of the app's reaches a
 * sandboxed frame, so each file is handed in as a `data:` URL in place of
 * the `textus-resource:` the plugin wrote (webview.asWebviewUri).
 */

/** Where a plugin's files are: shipped with the app, or on disk. */
export type PluginOrigin = "official" | "installed" | "dev";

/** A relative path inside the plugin, or an error: no `..`, no root. */
export function pluginPath(rel: string): string {
  const parts = rel.replace(/\\/g, "/").replace(/^\.?\//, "").split("/");
  if (!rel || parts.some((p) => p === ".." || p === "") || /^[a-z]+:/i.test(rel))
    throw new Error(`"${rel}" is not a file of the plugin.`);
  return parts.join("/");
}

/** The URL an official plugin's file is served at, beside the app. */
export function officialUrl(id: string, rel: string): string {
  return new URL(`plugins/official/${id}/${pluginPath(rel)}`, document.baseURI)
    .href;
}

export async function readPluginFile(
  id: string,
  origin: PluginOrigin,
  rel: string,
): Promise<Uint8Array> {
  if (origin === "official") {
    const response = await fetch(officialUrl(id, rel));
    if (!response.ok) throw new Error(`${rel}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
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

/** `html` with each `textus-resource:<path>` replaced by that file of the
 *  plugin's, as a `data:` URL. */
export async function withResources(
  html: string,
  read: (rel: string) => Promise<Uint8Array>,
): Promise<string> {
  const paths = [...new Set([...html.matchAll(RESOURCE)].map((m) => m[1]))];
  const urls = new Map<string, string>();
  await Promise.all(
    paths.map(async (rel) => {
      urls.set(rel, dataUrl(rel, await read(rel)));
    }),
  );
  return html.replace(RESOURCE, (_, rel: string) => urls.get(rel) ?? "");
}
