import hostRuntime from "./runtime/host.js?raw";
import webviewRuntime from "./runtime/webview.js?raw";
import pluginUiCss from "./runtime/plugin-ui.css?raw";
import { createEndpoint, type Endpoint, type Handlers } from "./rpc";

/**
 * The sandboxed frames a plugin runs in (docs/design/plugins.md §3): its
 * host, hidden, where its code runs, and its webviews, what it draws.
 *
 * Each is an `<iframe sandbox="allow-scripts">` written as `srcdoc`.
 * Without `allow-same-origin` its origin is opaque: none of the window's
 * storage, cookies, DOM or Tauri reach it, and its own Content Security
 * Policy keeps it off the network. What it can do goes through the one
 * MessagePort the window hands it once it has loaded (connectFrame).
 */

/** rpc.ts's createEndpoint as source, for the frames' runtimes. */
const RPC_SOURCE = `var createEndpoint = ${createEndpoint.toString()};`;

/** Text inside a `<script>`/`<style>` element can't hold its end tag. */
function inElement(code: string, tag: "script" | "style"): string {
  return code.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

/** The host's page: the runtime, then the plugin's code wrapped as a
 *  CommonJS module (runtime/host.js). No network, no other script. */
export function hostDocument(pluginCode: string): string {
  return [
    "<!doctype html><html><head><meta charset='utf-8'>",
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">`,
    `<script>${inElement(`${RPC_SOURCE}\n${hostRuntime}`, "script")}</script>`,
    `<script>__textusDefine(function (module, exports, textus) {\n${inElement(pluginCode, "script")}\n});</script>`,
    "</head><body></body></html>",
  ].join("\n");
}

/** A webview's Content Security Policy: its own inline and `data:`/`blob:`
 *  code, styles, images, fonts and media, no network - except frames from
 *  the HTTPS hosts in `frameHosts` (a plugin granted those hosts). */
export function webviewCsp(frameHosts: readonly string[]): string {
  const frames = frameHosts.length
    ? frameHosts
        .map((host) => (host === "*" ? "https:" : `https://${host}`))
        .join(" ")
    : "'none'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'wasm-unsafe-eval' data: blob:",
    "style-src 'unsafe-inline' data:",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src data: blob:",
    "worker-src data: blob:",
    `frame-src ${frames}`,
  ].join("; ");
}

/** A webview's page: the plugin's HTML with the policy, the theme, the UI
 *  kit and the runtime put first in its head. */
export function webviewDocument(
  html: string,
  options: {
    themeCss: string;
    dark: boolean;
    frameHosts: readonly string[];
    /** The UI's language and the plugin's strings (its manifest's l10n),
     *  there before the page's own scripts run (api.t). */
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
  return page.replace(/<html(\s[^>]*)?>/i, (tag) =>
    /data-theme=/i.test(tag)
      ? tag
      : tag.replace(/>$/, ` data-theme="${theme}">`),
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
 * Connects to `frame` each time its page loads (a webview's HTML set again
 * is a new page): a new channel, the old one closed, `init` sent with it.
 * `onConnect` gets the endpoint. Returns the function that stops.
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
