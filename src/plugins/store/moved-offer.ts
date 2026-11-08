import type { Strings } from "../../i18n/strings";
import { storage } from "../../platform/ipc";
import { getUiState, setUiState } from "../../storage/ui-state";
import { pluginRecord } from "../manager";
import { catalogSnapshot, loadCatalog } from "./catalog";
import { takeUp } from "./open-offer";
import { showPluginCard, type CardRequest } from "./plugin-card";

/** Features that left the core for an official plugin: the plugin, and
 *  whether this user used the feature. */
const MOVED: Record<string, { plugin: string; used: () => Promise<boolean> }> =
  {
    // 1.3.10. Its old entries stay where they were, unread.
    "clipboard-history": {
      plugin: "catvinci.clipboard-history",
      used: async () =>
        (await storage.historyList("clipboard").catch(() => [])).length > 0,
    },
  };

/** Offers each moved feature's plugin once, on the suggestion card, to
 *  those who used the feature and haven't the plugin. */
export async function offerMovedFeatures(t: Strings): Promise<void> {
  for (const [feature, { plugin, used }] of Object.entries(MOVED)) {
    const offered = getUiState("movedToPluginsOffered");
    const done = Array.isArray(offered) ? (offered as string[]) : [];
    if (done.includes(feature)) continue;
    if (!pluginRecord(plugin) && (await used())) {
      await loadCatalog().catch(() => {});
      const catalog = catalogSnapshot();
      // Offline: ask again next time.
      if (catalog.status !== "ready") continue;
      if (!catalog.items.some((i) => i.official && i.id === plugin)) continue;
      setUiState("movedToPluginsOffered", [...done, feature]);
      const request: CardRequest = {
        plugin,
        situation: { type: "moved", feature },
        installed: false,
      };
      if ((await showPluginCard(request)) === "install")
        await takeUp(request, t);
    } else setUiState("movedToPluginsOffered", [...done, feature]);
  }
}
