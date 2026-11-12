import { fill } from "../../i18n/fill";
import { canTrashFiles } from "../../platform/capabilities";
import { fs } from "../../platform/ipc";
import { imageLocation } from "../../editor/images/missing-image";
import { showConfirm, showMessage } from "../../engine/controls/app-dialog";
import type { Strings } from "../../i18n/strings";
import { explainError } from "../../utils/error-explain";

/** Offers to move a replaced picture's old file to the Trash, if it is a
 *  local file nothing in the document still shows. Keeping it is the default. */
export async function offerOldPictureTrash(
  oldSrc: string,
  docPath: string | null,
  t: Strings,
  documentMarkdown: () => string,
): Promise<void> {
  if (!canTrashFiles) return;
  const location = imageLocation(oldSrc, docPath);
  if (location.kind !== "local") return;
  // The same picture shown elsewhere in the document stays.
  if (documentMarkdown().includes(oldSrc)) return;
  const name = location.path.split(/[\\/]/).pop() ?? oldSrc;
  const move = await showConfirm(fill(t.oldPictureTrashQuestion, { name }), {
    okLabel: t.treeTrash,
    cancelLabel: t.oldPictureKeep,
    focusCancel: true,
  });
  if (!move) return;
  try {
    await fs.movePictureToTrash(docPath, location.path);
  } catch (err) {
    await showMessage(`${t.oldPictureTrashFailed}\n${explainError(err, t)}`, {
      tone: "error",
    });
  }
}
