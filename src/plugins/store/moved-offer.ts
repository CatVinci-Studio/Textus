import type { Strings } from "../../i18n/strings";
import { fs } from "../../platform/ipc";
import { openFolderOnDisk } from "../../platform/open-folder";
import { keepInList, uiList } from "../../storage/ui-state";
import { pluginRecord } from "./plugin-records";
import { catalogSnapshot, loadCatalog } from "./catalog";
import { takeUp } from "./open-offer";
import { showPluginCard, type CardRequest } from "./plugin-card";

/** Features that left the core for an official plugin: the plugin, and
 *  whether this user uses the feature - `now` when that shows only while
 *  it is in use, so it is asked again as folders open. */
const MOVED: Record<
  string,
  { plugin: string; used: () => Promise<boolean>; now?: boolean }
> = {
  // 1.4.6: a Logseq graph's settings.
  "logseq-settings": {
    plugin: "catvinci.logseq",
    now: true,
    used: async () => {
      const root = openFolderOnDisk();
      if (!root) return false;
      const found = await fs.folderConventions(root).catch(() => null);
      return !!found?.sources.some((s) => s.app === "logseq");
    },
  },
};

/** Offers each moved feature's plugin once, on the suggestion card, to
 *  those who used the feature and haven't the plugin. */
export async function offerMovedFeatures(t: Strings): Promise<void> {
  for (const [feature, { plugin, used, now }] of Object.entries(MOVED)) {
    if (uiList("movedToPluginsOffered").includes(feature)) continue;
    if (pluginRecord(plugin))
      keepInList("movedToPluginsOffered", feature, true);
    else if (await used()) {
      await loadCatalog().catch(() => {});
      const catalog = catalogSnapshot();
      // Offline: ask again next time.
      if (catalog.status !== "ready") continue;
      if (!catalog.items.some((i) => i.official && i.id === plugin)) continue;
      keepInList("movedToPluginsOffered", feature, true);
      const request: CardRequest = {
        plugin,
        situation: { type: "moved", feature },
        installed: false,
      };
      if ((await showPluginCard(request)) === "install")
        await takeUp(request, t);
    } else if (!now) keepInList("movedToPluginsOffered", feature, true);
  }
}
