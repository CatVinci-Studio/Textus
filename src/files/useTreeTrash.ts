import { useMemo } from "react";
import { fill } from "../i18n/fill";
import { counted } from "../i18n/current";
import type { Strings } from "../i18n/strings";
import {
  showConfirm,
  showConfirmCheck,
  showMessage,
} from "../engine/controls/app-dialog";
import { showNotice } from "../engine/controls/notices";
import { useSettingsIfAny } from "../prefs/SettingsContext";
import { useLatest } from "../utils/hooks/useLatest";
import { basename } from "../utils/path";
import type { TrashedEntry } from "./file-undo";
import { failureText, trashable, trashFromTree } from "./tree-shared";
import { outermost, type TreeRow, type TreeSelection } from "./tree-selection";
import type { FileUndo } from "./useFileUndo";

/** The question before rows go: to the Trash, or, with none (Android, a
 *  remote folder), deleted for good. */
function question(rows: readonly TreeRow[], t: Strings) {
  const [one] = rows;
  const name = one ? basename(one.path) : "";
  if (rows.length > 1)
    return {
      text: counted(t.treeTrashManyConfirm, rows.length),
      ok: t.treeTrash,
    };
  if (!trashable(one!.path))
    return { text: fill(t.docDeleteConfirm, { name }), ok: t.docDeleteOk };
  return {
    text: fill(one!.isDir ? t.treeTrashFolderConfirm : t.treeTrashConfirm, {
      name,
    }),
    ok: t.treeTrash,
  };
}

/**
 * Rows to the Trash from the tree, after asking (Settings › General, or the
 * question's Don't Ask Again; a delete for good is always asked): one after
 * another, a row inside a picked folder going with it, up to one that
 * can't go. What went is one step to undo, said in a notice with its Undo,
 * and the keyboard goes to the row beside.
 */
export function useTreeTrash(input: {
  root: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  selection: TreeSelection;
  fileUndo: FileUndo;
}) {
  const prefs = useSettingsIfAny();
  const latest = useLatest({ ...input, prefs });
  return useMemo(() => {
    const trashAll = async (rows: readonly TreeRow[]) => {
      const { root, t, reload, fileUndo } = latest.current;
      const trashed: TrashedEntry[] = [];
      let known = true;
      const next = fileUndo.rowBeside(rows.map((row) => row.path));
      for (const { path, isDir } of rows) {
        try {
          const place = await trashFromTree(path, root, reload);
          if (place === null) known = false;
          else trashed.push({ path, isDir, place });
        } catch (err) {
          await showMessage(failureText(t, err, basename(path)));
          break;
        }
      }
      fileUndo.show(next);
      if (!known || !trashed.length) return;
      showNotice(counted(t.treeTrashed, trashed.length), {
        action: fileUndo.record({ kind: "trashed", trashed }),
      });
    };
    /** Asks, unless told not to, then trashes `rows`. */
    const askTrash = async (rows: readonly TreeRow[]) => {
      const { t, selection, prefs } = latest.current;
      const forGood = rows.some((row) => !trashable(row.path));
      const ask = question(rows, t);
      const options = { okLabel: ask.ok, cancelLabel: t.cancel, danger: true };
      if (forGood) {
        if (!(await showConfirm(ask.text, options))) return;
      } else if (prefs?.settings.confirmTreeTrash ?? true) {
        const answer = await showConfirmCheck(ask.text, {
          ...options,
          checkLabel: t.treeCopyDontAsk,
        });
        if (!answer.ok) return;
        if (answer.checked) prefs?.setSettings({ confirmTreeTrash: false });
      }
      if (rows.length > 1) selection.clear();
      await trashAll(outermost(rows));
    };
    return { askTrash };
  }, [latest]);
}
