import { useEffect, useState } from "react";
import { SettingRow } from "../sections/controls";
import { showConfirm } from "../../ui/app-dialog";
import { plugins as pluginsIpc } from "../../platform/ipc";
import type { Strings } from "../../i18n/strings";
import { projectRoot } from "../../plugins/store/plugin-settings";

/** "12.3 KB", the way a file manager says it. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** What the plugin keeps, for every document and in the open project, and
 *  a way to empty it; nothing while it keeps nothing. */
export function PluginData({
  id,
  name,
  t,
}: {
  id: string;
  name: string;
  t: Strings;
}) {
  const root = projectRoot();
  const [usage, setUsage] = useState<[number, number] | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    pluginsIpc
      .storeUsage(id, root)
      .then((u) => live && setUsage(u as [number, number]))
      .catch(() => live && setUsage(null));
    return () => {
      live = false;
    };
  }, [id, root, round]);
  if (!usage || usage[0] + usage[1] === 0) return null;
  const [global, project] = usage;
  const parts = [
    global > 0 && t.pluginDataGlobal.replace("{global}", sizeText(global)),
    project > 0 && t.pluginDataProject.replace("{project}", sizeText(project)),
  ].filter(Boolean);
  const clear = async () => {
    const ok = await showConfirm(t.pluginDataClearAsk.replace("{name}", name), {
      okLabel: t.pluginDataClear,
      cancelLabel: t.pluginCancel,
      danger: true,
    });
    if (!ok) return;
    await pluginsIpc.storeClear(id, "global", null).catch(() => {});
    if (root) await pluginsIpc.storeClear(id, "project", root).catch(() => {});
    setRound((n) => n + 1);
  };
  return (
    <SettingRow label={t.pluginDataLabel} hint={parts.join(" · ")}>
      <button
        type="button"
        className="text-button settings-inline-button"
        onClick={() => void clear()}
      >
        {t.pluginDataClear}
      </button>
    </SettingRow>
  );
}
