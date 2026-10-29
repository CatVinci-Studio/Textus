import { useState } from "react";
import { showConfirm, showMessage } from "../../ui/app-dialog";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginText,
  pluginsSnapshot,
  setPluginEnabled,
  uninstallPlugin,
  type PluginRecord,
} from "../../plugins/manager";
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
import { explainError } from "../../utils/error-explain";

/** Installs a plugin from the catalog: fetched and checked in Rust, turned
 *  on with its permissions asked, and what it needs offered. Nothing opens
 *  after it, so several can be installed in a row. Failures show in a
 *  message. */
export function usePluginInstall(t: Strings) {
  const { settings, setSettings } = useSettings();
  const [installing, setInstalling] = useState<string | null>(null);

  const attempt: Attempt = async (work) => {
    try {
      await work();
    } catch (err) {
      void showMessage(explainError(err, t), {
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
      } finally {
        setInstalling(null);
      }
    });

  /** Turns a plugin on, then offers to turn on what it needs. */
  const enable = (record: PluginRecord, on: boolean) =>
    attempt(async () => {
      await setPluginEnabled(record.id, on);
      if (on) await askForRequirements(record.id, t, settings, setSettings);
    });

  /** Uninstalls a plugin, or unloads a folder loaded in development, once
   *  confirmed; true when it is gone. */
  const uninstall = async (record: PluginRecord) => {
    let gone = false;
    await attempt(async () => {
      const ok = await showConfirm(
        t.pluginUninstallAsk.replace("{name}", pluginName(record)),
        {
          title: t.pluginsTitle,
          okLabel: t.pluginUninstall,
          cancelLabel: t.pluginCancel,
          danger: true,
        },
      );
      if (!ok) return;
      await uninstallPlugin(record.id);
      gone = true;
    });
    return gone;
  };

  return {
    installing,
    install,
    enable,
    uninstall,
    attempt,
    settings,
    setSettings,
  };
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
