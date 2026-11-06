import type { PluginFile } from "../platform/ipc";
import { replyFiles } from "../ai/chat/reply-files";
import { parseManifest, type PluginManifest } from "./store/manifest";

/**
 * A plugin Textus AI wrote in a reply: each file in a fenced block whose info
 * string is the language and path (```js host.js). The manifest makes it one.
 */
export interface ReplyPlugin {
  /** The manifest, checked as an installed one is; null with `error`. */
  manifest: PluginManifest | null;
  error: string | null;
  files: PluginFile[];
}

const MANIFEST = "textus-plugin.json";

/** The plugins `text` writes - one per manifest, with the named files
 *  after it up to the next manifest. */
export function pluginsInReply(text: string): ReplyPlugin[] {
  const plugins: ReplyPlugin[] = [];
  let current: PluginFile[] | null = null;
  for (const { path, text: body } of replyFiles(text)) {
    if (!path) continue;
    const file = { path, text: body };
    if (path === MANIFEST) {
      current = [file];
      plugins.push({ manifest: null, error: null, files: current });
    } else if (current) current.push(file);
  }
  for (const plugin of plugins) {
    try {
      plugin.manifest = parseManifest(plugin.files[0].text);
    } catch (err) {
      plugin.error = err instanceof Error ? err.message : String(err);
    }
  }
  return plugins;
}
