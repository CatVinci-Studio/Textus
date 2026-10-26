import { currentStrings } from "../../i18n/current";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { showMessage, showPrompt } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";

/** The publisher name typed last, offered again. */
let lastPublisher = "";

/**
 * Export for Publishing… (a plugin's page, a chat's plugin card): asks
 * for the publisher's name its id will carry and a folder to put it in,
 * then lays it out there ready to be a GitHub repository (src-tauri
 * plugins/export.rs), and says where and what to do next.
 */
export async function exportPluginForPublishing(id: string): Promise<void> {
  const t = currentStrings();
  const publisher = (
    await showPrompt(t.pluginExportPrompt, lastPublisher, {
      okLabel: t.pluginExportChooseFolder,
      cancelLabel: t.cancel,
      placeholder: "jane",
    })
  )?.trim();
  if (!publisher) return;
  lastPublisher = publisher;
  const folder = await pluginsIpc.pickPackage(true, "").catch(() => null);
  if (!folder) return;
  try {
    const path = await pluginsIpc.exportPlugin(id, publisher, folder);
    await showMessage(t.pluginExportDone.replace("{path}", path), {
      title: t.pluginExport,
    });
  } catch (err) {
    await showMessage(errorText(err), { tone: "error" });
  }
}
