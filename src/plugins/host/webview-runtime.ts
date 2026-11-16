import core from "./runtime/webview-core.js?raw";
import input from "./runtime/webview-input.js?raw";
import api from "./runtime/webview-api.js?raw";

/**
 * A webview's runtime: what a plugin's panel, view or editor page is given
 * as `textus` (acquireTextusApi() returns the same), run before the
 * plugin's HTML in the sandboxed frame (frames.ts). It talks to its own
 * plugin's host only, through the window - as a VS Code webview does.
 * Plain JavaScript in parts, joined here inside one function; the joined
 * text is linted as one script (webview.test.ts).
 */
export const WEBVIEW_RUNTIME = [
  "/* global createEndpoint, localized */",
  "(function () {",
  '"use strict";',
  core,
  input,
  api,
  "})();",
].join("\n");
