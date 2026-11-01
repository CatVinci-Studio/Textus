import webviewRuntime from "./runtime/webview.js?raw";
import componentsCss from "../../ui/components.css?raw";
import designSystemCss from "../../ui/design-system.css?raw";
import motionCss from "../../ui/motion.css?raw";
import pluginUiCss from "./runtime/plugin-ui.css?raw";

/** The window's own stylesheets, as one: a plugin page's controls are the
 *  app's, from the same rules. Their @imports are inlined here. */
const SHARED_CSS = [
  motionCss,
  designSystemCss.replace(/^@import [^;]+;$/gm, ""),
  componentsCss,
].join("\n");
import { createEndpoint, type Endpoint, type Handlers } from "./rpc";

/**
 * The sandboxed frames a plugin runs in: its hidden host and its webviews.
 * Without `allow-same-origin` the origin is opaque, and the CSP keeps it off
 * the network; everything goes through one MessagePort.
 */

/** The RPC endpoint as source, for the frames' runtimes. */
export const RPC_SOURCE = `var createEndpoint = ${createEndpoint.toString()};`;

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
  },
): string {
  const locale = JSON.stringify({
    language: options.language,
    l10n: options.l10n,
  });
  const head = [
    "<meta charset='utf-8'>",
    `<meta http-equiv="Content-Security-Policy" content="${webviewCsp(options.frameHosts)}">`,
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
  const page = at
    ? html.slice(0, at.index + at[0].length) +
      head +
      html.slice(at.index + at[0].length)
    : `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
  // The window's platform too, so the shared controls take the phone's
  // sizes on a phone.
  const { windowChrome, platform } = document.documentElement.dataset;
  const platformAttrs = [
    windowChrome ? ` data-window-chrome="${windowChrome}"` : "",
    platform ? ` data-platform="${platform}"` : "",
  ].join("");
  return page.replace(/<html(\s[^>]*)?>/i, (tag) =>
    tag.replace(
      />$/,
      `${/data-theme=/i.test(tag) ? "" : ` data-theme="${theme}"`}${platformAttrs}>`,
    ),
  );
}

/** A sandboxed frame, not yet in the page. */
export function sandboxedFrame(
  srcdoc: string,
  title: string,
): HTMLIFrameElement {
  const frame = document.createElement("iframe");
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
    const data = event.data as { textus?: string } | null;
    if (data?.textus !== "ready") return;
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
