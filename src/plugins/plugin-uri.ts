import { currentStrings } from "../i18n/current";
import { plugins as pluginsIpc } from "../platform/ipc";
import { showMessage } from "../ui/app-dialog";
import { askPlugin, loadPlugins } from "./manager";

/**
 * `textus://<plugin id>/<path>?<query>` - a link opened from outside
 * Textus for one plugin (textus.uri.registerHandler; src-tauri
 * plugins/uri.rs). The plugin it names gets the path and the query.
 */
export interface PluginUri {
  plugin: string;
  /** From the slash after the plugin's id: "/item", or "/" for none. */
  path: string;
  query: Record<string, string>;
}

const ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** The link as its plugin is given it; null when it isn't one. */
export function parsePluginUri(link: string): PluginUri | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "textus:") return null;
  const plugin = url.hostname.toLowerCase();
  if (!ID.test(plugin)) return null;
  return {
    plugin,
    path: decodeURIComponent(url.pathname || "/") || "/",
    query: Object.fromEntries(url.searchParams),
  };
}

/**
 * Takes the links waiting for this window and gives each to the plugin it
 * names - started first if it hasn't been. One no plugin that is on takes
 * (not installed, turned off, or with no handler) is said so.
 */
export async function takePluginUris(): Promise<void> {
  // The plugins known first: a link can come before the window has them.
  await loadPlugins();
  const links = await pluginsIpc.takeUris().catch(() => [] as string[]);
  for (const link of links) {
    const uri = parsePluginUri(link);
    const taken =
      !!uri &&
      (await askPlugin(uri.plugin, "$uri", {
        path: uri.path,
        query: uri.query,
      }).then(
        (answer) => answer === true,
        () => false,
      ));
    if (!taken)
      void showMessage(
        currentStrings().pluginUriNotTaken.replace("{link}", link),
        { tone: "error" },
      );
  }
}
