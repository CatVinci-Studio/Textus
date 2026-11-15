import { fill } from "../i18n/fill";
import type { Strings } from "../i18n/strings";
import {
  showConfirm,
  showMessage,
  showPrompt,
} from "../engine/controls/app-dialog";
import { deleteIOSDocument, renameIOSDocument } from "../document/ios-recents";
import { updateLinksAfterMove } from "../files/move-links";
import { emitPluginEvent } from "../plugins/app-bridge";
import { basename, dirname } from "../utils/path";

/** The phone's document list renaming and deleting a document of its own,
 *  with what follows as in the file tree: links to it rewritten, plugins
 *  told of a delete. */

export const documentActionFailed = (t: Strings, error: unknown) =>
  showMessage(String(error), { title: t.docActionFailed, tone: "error" });

export async function renameDocument(
  path: string,
  t: Strings,
  onRenamed: (from: string, to: string) => void,
): Promise<boolean> {
  const name = await showPrompt(t.docRenamePrompt, basename(path), {
    title: t.docRename,
    okLabel: t.docRenameOk,
    cancelLabel: t.cancel,
  });
  if (!name || name === basename(path)) return false;
  try {
    const to = await renameIOSDocument(path, name);
    onRenamed(path, to);
    void updateLinksAfterMove(path, to, dirname(path), t);
    return true;
  } catch (error) {
    await documentActionFailed(t, error);
    return false;
  }
}

export async function deleteDocument(
  path: string,
  t: Strings,
  onDeleted: (path: string) => void,
): Promise<boolean> {
  const ok = await showConfirm(
    fill(t.docDeleteConfirm, { name: basename(path) }),
    {
      title: t.docDelete,
      tone: "warning",
      okLabel: t.docDeleteOk,
      cancelLabel: t.cancel,
      danger: true,
    },
  );
  if (!ok) return false;
  try {
    await deleteIOSDocument(path);
    onDeleted(path);
    emitPluginEvent("fileDelete", { path });
    return true;
  } catch (error) {
    await documentActionFailed(t, error);
    return false;
  }
}
