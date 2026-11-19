import core from "./runtime/host-core.js?raw";
import apiUi from "./runtime/host-api-ui.js?raw";
import apiEditor from "./runtime/host-api-editor.js?raw";
import apiData from "./runtime/host-api-data.js?raw";
import apiRemote from "./runtime/host-api-remote.js?raw";
import handlers from "./runtime/host-handlers.js?raw";

/**
 * The plugin host's runtime: the `textus` API a plugin's code is given, run
 * in the plugin's hidden, sandboxed frame (frames.ts) before its code. Every
 * call goes to the window as JSON-RPC (rpc.ts's createEndpoint, put in
 * front of it); the window checks it against what the plugin was granted.
 * Plain JavaScript in parts, joined here inside one function, so what the
 * parts share stays out of the plugin's reach. Its declared types are kept
 * in step by textus-types.test.ts; the joined text is linted as one script.
 */
export const HOST_RUNTIME = [
  "/* global createEndpoint, localized, __textusText */",
  "(function () {",
  '"use strict";',
  core,
  apiUi,
  apiEditor,
  apiData,
  apiRemote,
  handlers,
  "})();",
].join("\n");
