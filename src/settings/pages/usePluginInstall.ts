import { fill } from "../../i18n/fill";
import { useState } from "react";
import { showConfirm, showMessage } from "../../engine/controls/app-dialog";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginText,
  pluginsSnapshot,
  type PluginRecord,
} from "../../plugins/store/plugin-records";
import {
  setPluginEnabled,
  uninstallPlugin,
} from "../../plugins/plugin-switches";
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

  /** Updates each of `items` in turn; one that fails is named at the end,
   *  the rest still update. */
  const updateAll = async (items: CatalogItem[]) => {
    const failed: string[] = [];
    for (const item of items) {
      setInstalling(item.id);
      try {
        await installFromCatalog(item.id);
        await askForRequirements(item.id, t, settings, setSettings);
      } catch {
        const record = pluginsSnapshot().records.find((r) => r.id === item.id);
        failed.push(
          pluginName(record ?? { id: item.id, manifest: item.manifest }),
        );
      }
    }
    setInstalling(null);
    if (failed.length)
      void showMessage(
        fill(t.pluginsUpdateAllFailed, { names: failed.join(", ") }),
        { title: t.pluginsTitle, tone: "error" },
      );
  };

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
        fill(t.pluginUninstallAsk, { name: pluginName(record) }),
        {
          title: t.pluginsTitle,
          okLabel: t.pluginUninstall,
          cancelLabel: t.cancel,
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
    updateAll,
    enable,
    uninstall,
    attempt,
    settings,
    setSettings,
  };
}

/** What a plugin needs that is off: asked to turn each on, once, in the
 *  plugin's words. */
async function askForRequirements(
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
      fill(t.pluginRequiresAsk, {
        name: pluginName(record),
        setting: requirementLabel(need, t),
        reason: need.reason ? pluginText(record, need.reason) : "",
      }),
      {
        title: pluginName(record),
        okLabel: t.pluginRequiresTurnOn,
        cancelLabel: t.pluginRequiresLater,
      },
    );
    if (ok) setSettings(turnOnRequirement(need));
  }
}
