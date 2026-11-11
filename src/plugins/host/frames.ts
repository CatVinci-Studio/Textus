import { pluginString } from "./plugin-string";
import webviewRuntime from "./runtime/webview.js?raw";
import componentsCss from "../../engine/controls/components.css?inline";
import iconMasksCss from "../../engine/controls/icon-masks.css?inline";
import controlsCss from "../../engine/controls/controls.css?inline";
import progressCss from "../../engine/controls/progress.css?inline";
import bubbleCss from "../../engine/controls/bubble.css?inline";
import designSystemCss from "../../engine/tokens/design-system.css?inline";
import motionCss from "../../engine/motion/motion.css?inline";
// Processed as the app's own are, their lengths scaled (vite.chrome-scale.ts).
import pluginUiCss from "./runtime/plugin-ui.css?inline";

/** The window's own stylesheets, as one: a plugin page's controls are the
 *  app's, from the same rules. Their @imports are inlined here. */
const SHARED_CSS = [
  motionCss,
  designSystemCss.replace(/^@import [^;]+;$/gm, ""),
  componentsCss,
  iconMasksCss,
  controlsCss,
  progressCss,
  bubbleCss,
].join("\n");
import { createEndpoint, type Endpoint, type Handlers } from "./rpc";

/**
 * The sandboxed frames a plugin runs in: its hidden host and its webviews.
 * Without `allow-same-origin` the origin is opaque, and the CSP keeps it off
 * the network; everything goes through one MessagePort.
 */

/** The RPC endpoint as source, for the frames' runtimes. */
export const RPC_SOURCE = `var createEndpoint = ${createEndpoint.toString()};\nvar localized = ${pluginString.toString()};`;

/** Text inside a `<script>`/`<style>` element can't hold its end tag; a
 *  script can't hold "<!--" and "<script" either, which take the HTML
 *  parser past its end (a bundled Markdown parser has both in its rules).
 *  `\x3C` reads as "<" in a string, a template or a regex alike. */
export function inElement(code: string, tag: "script" | "style"): string {
  const ended = code.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
  return tag === "script" ? ended.replace(/<(?=!--|script)/gi, "\\x3C") : ended;
}

/** The plugins' own files, as served on macOS and Linux, and on Windows. */
const PLUGIN_FILES = "textus-plugin: http://textus-plugin.localhost";

/** A webview's CSP: its own inline and `data:`/`blob:` content and the
 *  plugins' files, no network, except frames from the HTTPS hosts in
 *  `frameHosts`. */
export function webviewCsp(frameHosts: readonly string[]): string {
  const frames = frameHosts.length
    ? frameHosts
        .map((host) => (host === "*" ? "https:" : `https://${host}`))
        .join(" ")
    : "'none'";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'wasm-unsafe-eval' data: blob: ${PLUGIN_FILES}`,
    `style-src 'unsafe-inline' data: ${PLUGIN_FILES}`,
    `img-src data: blob: ${PLUGIN_FILES}`,
    `font-src data: ${PLUGIN_FILES}`,
    `media-src data: blob: ${PLUGIN_FILES}`,
    `connect-src data: blob: ${PLUGIN_FILES}`,
    `worker-src data: blob: ${PLUGIN_FILES}`,
    `frame-src ${frames}`,
  ].join("; ");
}

/** A webview's page: the plugin's HTML with the policy, theme, UI kit and
 *  runtime first in its head. */
export function webviewDocument(
  html: string,
  options: {
    themeCss: string;
    dark: boolean;
    frameHosts: readonly string[];
    /** The UI's language and the plugin's strings, there before its scripts run. */
    language: string;
    l10n: Record<string, Record<string, string>>;
    /** A floating view's page: no background of its own, so what the
     *  plugin draws floats on its own. */
    floating?: boolean;
    /** A sidebar tab's page: the sidebar's own colour behind it. */
    sidebar?: boolean;
  },
): string {
  const locale = JSON.stringify({
    language: options.language,
    l10n: options.l10n,
  });
  // The policy first of all, ahead of any of the plugin's bytes: put after
  // its <head>, a <head> in a comment or after a script kept it out of the
  // page's head, where it applies.
  const policy = [
    "<meta charset='utf-8'>",
    `<meta http-equiv="Content-Security-Policy" content="${webviewCsp(options.frameHosts)}">`,
  ].join("\n");
  const head = [
    `<style id="textus-theme">${inElement(options.themeCss, "style")}</style>`,
    `<style id="textus-ui">${inElement(pluginUiCss, "style")}</style>`,
    `<style id="textus-shared">${inElement(SHARED_CSS, "style")}</style>`,
    `<script type="application/json" id="textus-locale">${inElement(locale, "script")}</script>`,
    `<script>${inElement(`${RPC_SOURCE}\n${webviewRuntime}`, "script")}</script>`,
  ].join("\n");
  const theme = options.dark ? "dark" : "light";
  // Into the plugin's own <head> if it has one, so its <meta> and styles
  // come after ours; else ahead of everything.
  const at = /<head(\s[^>]*)?>/i.exec(html);
  const inner = at
    ? html.slice(0, at.index + at[0].length) +
      head +
      html.slice(at.index + at[0].length)
    : `<html><head>${head}</head><body>${html}</body></html>`;
  // After a doctype of its own (before it, the page would lose standards
  // mode); else one of ours.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(inner);
  const page = doctype
    ? doctype[0] + policy + inner.slice(doctype[0].length)
    : `<!doctype html>${policy}${inner}`;
  // The window's platform too, so the shared controls take the phone's
  // sizes on a phone.
  const { windowChrome, platform } = document.documentElement.dataset;
  const platformAttrs = [
    windowChrome ? ` data-window-chrome="${windowChrome}"` : "",
    platform ? ` data-platform="${platform}"` : "",
    options.floating ? " data-floating" : "",
    options.sidebar ? " data-sidebar" : "",
  ].join("");
  return page.replace(/<html(\s[^>]*)?>/i, (tag) =>
    tag.replace(
      />$/,
      `${/data-theme=/i.test(tag) ? "" : ` data-theme="${theme}"`}${platformAttrs}>`,
    ),
  );
}

/** Stands in the runtimes' `ready` for the key of the frame they run in. */
const FRAME_KEY = "__TEXTUS_FRAME_KEY__";
/** Each frame's key: what says `ready` comes from the page the app put
 *  there, not one the frame was sent to since. */
const frameKeys = new WeakMap<HTMLIFrameElement, string>();

/** A sandboxed frame, not yet in the page. */
export function sandboxedFrame(
  srcdoc: string,
  title: string,
): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  const key = crypto.randomUUID();
  frameKeys.set(frame, key);
  srcdoc = srcdoc.split(FRAME_KEY).join(key);
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", title);
  // Referrers name the app's page; a plugin's frame of a web page
  // shouldn't tell that page where it is shown.
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = srcdoc;
  return frame;
}

/**
 * Connects to `frame` each time its page loads: a new channel, the old one
 * closed, `init` sent with it. Returns the function that stops.
 */
export function connectFrame(
  frame: HTMLIFrameElement,
  handlers: Handlers,
  init: () => Record<string, unknown>,
  onConnect: (endpoint: Endpoint) => void,
  timeoutMs = 0,
): () => void {
  let endpoint: Endpoint | null = null;
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { textus?: string; key?: string } | null;
    if (data?.textus !== "ready" || data.key !== frameKeys.get(frame)) return;
    endpoint?.close();
    const channel = new MessageChannel();
    endpoint = createEndpoint(channel.port1, handlers, timeoutMs);
    frame.contentWindow?.postMessage({ textus: "init", ...init() }, "*", [
      channel.port2,
    ]);
    onConnect(endpoint);
  };
  window.addEventListener("message", receive);
  return () => {
    window.removeEventListener("message", receive);
    endpoint?.close();
    endpoint = null;
  };
}

/** Where the hosts' frames live: out of sight, still running. */
export function hostsContainer(): HTMLElement {
  let box = document.getElementById("plugin-hosts");
  if (!box) {
    box = document.createElement("div");
    box.id = "plugin-hosts";
    box.className = "plugin-hosts";
    box.setAttribute("aria-hidden", "true");
    document.body.append(box);
  }
  return box;
}
