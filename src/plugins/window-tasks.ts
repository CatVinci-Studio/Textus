import type { Strings } from "../i18n/strings";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { watchPluginAiTools } from "./contributions/ai-tools";
import { takePluginUris } from "./plugin-uri";
import { watchDevPlugins } from "./store/dev-reload";
import { offerMovedFeatures } from "./store/moved-offer";
import { onOpenFolder } from "../platform/open-folder";
import { currentStrings } from "../i18n/current";
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

/** Once the plugins are read: the core's features that became plugins
 *  offered, once. */
export async function afterPluginsLoad(t: Strings): Promise<void> {
  await offerMovedFeatures(t);
  // Some show only in a folder: asked again as one opens.
  onOpenFolder(() => void offerMovedFeatures(currentStrings()));
}
