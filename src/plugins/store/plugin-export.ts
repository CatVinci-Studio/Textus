import { currentStrings } from "../../i18n/current";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { showMessage, showPrompt } from "../../ui/app-dialog";
import { explainError } from "../../utils/error-explain";

/** The publisher name typed last, offered again. */
let lastPublisher = "";

/**
 * Export for Publishing…: asks for a publisher name and a folder, lays the
 * plugin out there ready to be a GitHub repository, and says what's next.
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
    await showMessage(explainError(err, t), { tone: "error" });
  }
}
