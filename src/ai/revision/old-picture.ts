import { canTrashFiles } from "../../platform/capabilities";
import { fs } from "../../platform/ipc";
import { imageLocation } from "../../editor/images/missing-image";
import { showConfirm, showMessage } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";
import type { Strings } from "../../i18n/strings";

/**
 * A redone picture is in (generate_image's `replace`, accepted): the old
 * one's file is still on disk. Offered, never done unasked: the file goes
 * to the system's Trash - not deleted, it can be put back - if it is a
 * file on this computer and nothing left in the document still shows it.
 * Kept is the default answer.
 */
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
  const move = await showConfirm(
    t.oldPictureTrashQuestion.replace("{name}", name),
    {
      okLabel: t.oldPictureTrashOk,
      cancelLabel: t.oldPictureKeep,
      focusCancel: true,
    },
  );
  if (!move) return;
  try {
    await fs.movePictureToTrash(docPath, location.path);
  } catch (err) {
    await showMessage(`${t.oldPictureTrashFailed}\n${errorText(err)}`, {
      tone: "error",
    });
  }
}
