import { useEffect, useState, type RefObject } from "react";
import { canDropFilesIntoTree } from "../platform/capabilities";
import { useSettings } from "../prefs/SettingsContext";
import { showConfirmCheck, showMessage } from "../engine/controls/app-dialog";
import {
  endProgress,
  reportProgress,
  showNotice,
  startProgress,
} from "../engine/controls/notices";
import { fill } from "../i18n/fill";
import { counted } from "../i18n/current";
import { basename, folderName } from "../utils/path";
import { isFarUrl } from "../platform/far-files";
import { explainError } from "../utils/error-explain";
import { useLatest } from "../utils/hooks/useLatest";
import { canTakeInto, dropDirAt } from "./tree-shared";
import type { DraggedFile } from "../engine/controls/document-drop";
import { copyQuestion, setTreeFileDrop, type RowsBack } from "./tree-file-drop";
import { copyIn, type FileStep, type MadeEntry } from "./file-undo";
import type { TreeTransfer } from "./useTreeTransfer";

/**
 * Files and folders from a file manager let go on the tree, with a folder
 * open: the folder under the pointer lit as for a row dragged there, and
 * on the drop, after asking (Settings › General, or the dialog's Don't Ask
 * Again), copied into it one after another - never moved, never over a
 * name there. What fails is said by name once the rest are in. The first
 * copy is then picked and shown (`show`), and the drop can be undone
 * (`record`, useFileUndo). The tree's own rows, dragged out of the window
 * and brought back onto a folder, are moved or copied there as a row
 * dragged within it (`transfer`), with a folder open or not. Returns the
 * folder lit.
 */
export function useTreeFileDrop(
  treeRef: RefObject<HTMLDivElement | null>,
  /** The folder open in the window; null with none, when a drop on the
   *  sidebar opens the files as before. */
  folder: string | null,
  reload: (...dirs: string[]) => void,
  show: (path: string, isDir: boolean) => void,
  /** Keeps the drop to undo; returns its notice's Undo. */
  record: (step: FileStep) => { label: string; run: () => void } | undefined,
  transfer: TreeTransfer["transfer"],
): string | null {
  const { settings, setSettings, t } = useSettings();
  const [into, setInto] = useState<string | null>(null);
  const latest = useLatest({
    settings,
    setSettings,
    t,
    reload,
    show,
    record,
    transfer,
  });

  useEffect(() => {
    if (!canDropFilesIntoTree) return;
    // A plugin's folder takes no copies from the disk: what is let go on
    // the sidebar opens, as with no folder.
    const takesCopies = !!folder && !isFarUrl(folder);
    const copyAll = async (files: readonly DraggedFile[], dir: string) => {
      const { t, reload, show } = latest.current;
      const where = { folder: folderName(dir) };
      const progress = startProgress(fill(t.treeCopying, where));
      const failed: string[] = [];
      const made: MadeEntry[] = [];
      let copied = 0;
      for (const [i, { path, isDir }] of files.entries()) {
        reportProgress(progress, {
          fraction: i / files.length,
          message: basename(path),
        });
        try {
          const done = await copyIn(path, isDir, dir, "numbered", reload);
          if (done.made) made.push(done.made);
          if (copied++ === 0) show(done.copy, isDir);
        } catch (err) {
          failed.push(
            `${fill(t.treeCopyFailed, { name: basename(path) })}: ${explainError(err, t)}`,
          );
        }
      }
      endProgress(progress);
      const undo = latest.current.record({ kind: "made", made });
      if (copied)
        showNotice(fill(counted(t.treeCopied, copied), where), {
          action: undo,
        });
      if (failed.length)
        await showMessage(failed.join("\n"), { tone: "error" });
    };
    const drop = async (files: readonly DraggedFile[], dir: string) => {
      const { settings, setSettings, t } = latest.current;
      if (settings.confirmTreeCopy) {
        const answer = await showConfirmCheck(
          copyQuestion(
            files.map((f) => f.path),
            dir,
            t,
            settings.language,
          ),
          {
            okLabel: t.copy,
            cancelLabel: t.cancel,
            checkLabel: t.treeCopyDontAsk,
          },
        );
        if (!answer.ok) return;
        if (answer.checked) setSettings({ confirmTreeCopy: false });
      }
      await copyAll(files, dir);
    };
    /** The folder at (x, y), when the tree takes what is dragged. */
    const dirAt = (x: number, y: number, back?: RowsBack) =>
      back || takesCopies ? dropDirAt(treeRef.current, x, y) : null;
    const fits = (
      files: readonly DraggedFile[],
      dir: string,
      back?: RowsBack,
    ) => !back || canTakeInto(files, dir, back.copy);
    setTreeFileDrop({
      over(files, x, y, back) {
        const dir = dirAt(x, y, back);
        setInto(dir !== null && fits(files, dir, back) ? dir : null);
        return dir !== null;
      },
      leave: () => setInto(null),
      drop(files, x, y, back) {
        const dir = dirAt(x, y, back);
        setInto(null);
        if (dir === null) return false;
        if (!files.length || !fits(files, dir, back)) return true;
        if (back)
          void latest.current.transfer(files, dir, back.copy ? "copy" : "move");
        else void drop(files, dir);
        return true;
      },
    });
    return () => {
      setTreeFileDrop(null);
      setInto(null);
    };
  }, [folder, treeRef, latest]);

  return into;
}
