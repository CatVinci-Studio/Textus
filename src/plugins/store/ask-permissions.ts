import { showConfirm } from "../../engine/controls/app-dialog";
import type { Permission } from "./manifest";
import { permissionLabel } from "./permissions";
import { pluginName, windowInfo, type PluginRecord } from "./plugin-records";

/** Asks the user for what the plugin asks that it hasn't been granted;
 *  the full list when granted, null when refused. */
export async function askPermissions(
  record: PluginRecord,
): Promise<Permission[] | null> {
  const wanted = record.manifest?.permissions ?? [];
  const missing = wanted.filter((p) => !record.granted.includes(p));
  if (!missing.length) return wanted;
  const t = windowInfo().strings();
  const list = missing.map((p) => `• ${permissionLabel(p, t)}`).join("\n");
  const ok = await showConfirm(
    `${t.pluginPermissionsAsk.replace("{name}", pluginName(record))}\n\n${list}`,
    {
      title: t.pluginsTitle,
      okLabel: t.pluginAllow,
      cancelLabel: t.pluginCancel,
    },
  );
  return ok ? wanted : null;
}
