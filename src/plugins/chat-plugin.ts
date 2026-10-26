import type { PluginFile } from "../platform/ipc";
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
const FENCE = /^(`{3,})([^\n`]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

/** The path a fence's info string names: its last word with a dot or a
 *  slash in it ("js host.js" → host.js), or null for a plain language. */
function pathOf(info: string): string | null {
  const words = info.trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  return words.length > 1 && /[./]/.test(last) ? last : null;
}

/** The plugins `text` writes - one per manifest, with the named files
 *  after it up to the next manifest. */
export function pluginsInReply(text: string): ReplyPlugin[] {
  const plugins: ReplyPlugin[] = [];
  let current: PluginFile[] | null = null;
  for (const m of text.matchAll(FENCE)) {
    const path = pathOf(m[2]);
    if (!path) continue;
    const file = { path, text: m[3] + "\n" };
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
