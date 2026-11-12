import type { Strings } from "../i18n/strings";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { watchPluginAiTools } from "./contributions/ai-tools";
import { takePluginUris } from "./plugin-uri";
import { watchDevPlugins } from "./store/dev-reload";
import { migrateOfficialPlugins } from "./store/migrate-official";
import { offerMovedFeatures } from "./store/moved-offer";
import type { runPluginAiTool } from "./manager";

/**
 * What a window starts for its plugins once it is up, none needed for its
 * first frame: a folder in development reloaded as it changes, textus://
 * links (those that came before the window, then each as it comes), the
 * tools plugins give Textus AI. Returns the stop.
 */
export function startWindowTasks(runTool: typeof runPluginAiTool): () => void {
  const stops = [
    watchDevPlugins(),
    watchPluginAiTools(runTool),
    unlistenAll(listenToThisWindow("plugin-uri", () => void takePluginUris())),
  ];
  void takePluginUris();
  return () => stops.forEach((stop) => stop());
}

/** Once the plugins are read: official plugins from before API 1.0 moved
 *  to their rewrites, then, once, the core's features that became plugins
 *  offered. */
export async function afterPluginsLoad(t: Strings): Promise<void> {
  await migrateOfficialPlugins();
  await offerMovedFeatures(t);
}
