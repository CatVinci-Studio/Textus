import { useState } from "react";
import { showConfirm, showMessage } from "../../ui/app-dialog";
import { useSettings } from "../SettingsContext";
import { errorText } from "../../utils/error-text";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText, pluginsSnapshot } from "../../plugins/manager";
import {
  installFromCatalog,
  type CatalogItem,
} from "../../plugins/store/catalog";
import {
  requirementLabel,
  requirementMet,
  turnOnRequirement,
} from "../../plugins/store/requirements";
import type { Attempt } from "./PluginPage";

/**
 * Installing a plugin from the catalog, as Settings › Plugins and the
 * market (MarketPage) both do: the package fetched and checked in Rust,
 * the plugin turned on - asking for its permissions - and what it needs
 * that is off offered to be turned on. A failure is said in a message.
 */
export function usePluginInstall(
  t: Strings,
  /** After a plugin is installed and on (MarketPage: its usage guide). */
  onInstalled?: (id: string) => void,
) {
  const { settings, setSettings } = useSettings();
  const [installing, setInstalling] = useState<string | null>(null);

  const attempt: Attempt = async (work) => {
    try {
      await work();
    } catch (err) {
      void showMessage(errorText(err), {
        title: t.pluginsTitle,
        tone: "error",
      });
    }
  };

  const install = (item: CatalogItem) =>
    attempt(async () => {
      setInstalling(item.id);
      try {
        await installFromCatalog(item.id);
        await askForRequirements(item.id, t, settings, setSettings);
        onInstalled?.(item.id);
      } finally {
        setInstalling(null);
      }
    });

  return { installing, install, attempt, settings, setSettings };
}

/** What a plugin needs that is off: asked to turn each on, once, in the
 *  plugin's words. */
export async function askForRequirements(
  id: string,
  t: Strings,
  settings: ReturnType<typeof useSettings>["settings"],
  setSettings: ReturnType<typeof useSettings>["setSettings"],
) {
  const record = pluginsSnapshot().records.find((r) => r.id === id);
  if (!record?.manifest || record.status !== "on") return;
  for (const need of record.manifest.requires) {
    if (requirementMet(need, settings)) continue;
    const ok = await showConfirm(
      t.pluginRequiresAsk
        .replace("{name}", pluginName(record))
        .replace("{setting}", requirementLabel(need, t))
        .replace(
          "{reason}",
          need.reason ? pluginText(record, need.reason) : "",
        ),
      {
        title: pluginName(record),
        okLabel: t.pluginRequiresTurnOn,
        cancelLabel: t.pluginRequiresLater,
      },
    );
    if (ok) setSettings(turnOnRequirement(need));
  }
}
