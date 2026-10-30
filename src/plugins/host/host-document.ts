import hostRuntime from "./runtime/host.js?raw";
import { inElement, RPC_SOURCE } from "./frames";

/** The host's page: the runtime, then the plugin's code wrapped as a
 *  CommonJS module. No network, no other script. Kept apart from frames.ts
 *  so the runtime loads with the broker, not at startup. `background`: its
 *  background code, which gets no editor or UI. */
export function hostDocument(pluginCode: string, background = false): string {
  return [
    "<!doctype html><html><head><meta charset='utf-8'>",
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">`,
    ...(background
      ? ["<script>window.__textusBackground = true;</script>"]
      : []),
    `<script>${inElement(`${RPC_SOURCE}\n${hostRuntime}`, "script")}</script>`,
    `<script>__textusDefine(function (module, exports, textus) {\n${inElement(pluginCode, "script")}\n});</script>`,
    "</head><body></body></html>",
  ].join("\n");
}
