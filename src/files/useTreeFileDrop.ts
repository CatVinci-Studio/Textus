import { useEffect, useState, type RefObject } from "react";
import { fs } from "../platform/ipc";
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
import { plural } from "../i18n/plural";
import { basename, folderName } from "../utils/path";
import {
  announceFileCreated,
  FILE_WRITTEN_EVENT,
  sendAppEvent,
} from "../utils/events";
import { isFarUrl } from "../platform/far-files";
import { explainError } from "../utils/error-explain";
import { useLatest } from "../utils/hooks/useLatest";
import { dropDirAt } from "./tree-shared";
import type { DraggedFile } from "../engine/controls/document-drop";
import { copyQuestion, setTreeFileDrop } from "./tree-file-drop";

/**
 * Files and folders from a file manager let go on the tree, with a folder
 * open: the folder under the pointer lit as for a row dragged there, and
 * on the drop, after asking (Settings › General, or the dialog's Don't Ask
 * Again), copied into it one after another - never moved, never over a
 * name there. What fails is said by name once the rest are in. The first
 * copy is then picked and shown (`show`). Returns the folder lit.
 */
export function useTreeFileDrop(
  treeRef: RefObject<HTMLDivElement | null>,
  /** The folder open in the window; null with none, when a drop on the
   *  sidebar opens the files as before. */
  folder: string | null,
  reload: (...dirs: string[]) => void,
  show: (path: string, isDir: boolean) => void,
): string | null {
  const { settings, setSettings, t } = useSettings();
  const [into, setInto] = useState<string | null>(null);
  const latest = useLatest({ settings, setSettings, t, reload, show });

  useEffect(() => {
    // A plugin's folder takes no copies from the disk: what is let go on
    // the sidebar opens, as with no folder.
    if (!folder || !canDropFilesIntoTree || isFarUrl(folder)) return;
    const copyAll = async (files: readonly DraggedFile[], dir: string) => {
      const { t, reload, show } = latest.current;
      const where = { folder: folderName(dir) };
      const progress = startProgress(fill(t.treeCopying, where));
      const failed: string[] = [];
      let copied = 0;
      for (const [i, { path, isDir }] of files.entries()) {
        reportProgress(progress, {
          fraction: i / files.length,
          message: basename(path),
        });
        try {
          const made = await fs.copyIntoFolder(path, dir);
          reload(dir);
          // A folder is no file a plugin made; the tree and search hear of
          // it as of one moved in.
          if (isDir) sendAppEvent(FILE_WRITTEN_EVENT, made);
          else announceFileCreated(made);
          if (copied++ === 0) show(made, isDir);
        } catch (err) {
          failed.push(
            `${fill(t.treeCopyFailed, { name: basename(path) })}: ${explainError(err, t)}`,
          );
        }
      }
      endProgress(progress);
      const lang = latest.current.settings.language;
      if (copied) showNotice(fill(plural(t.treeCopied, copied, lang), where));
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
    setTreeFileDrop({
      over(x, y) {
        const dir = dropDirAt(treeRef.current, x, y);
        setInto(dir);
        return dir !== null;
      },
      leave: () => setInto(null),
      drop(files, x, y) {
        const dir = dropDirAt(treeRef.current, x, y);
        setInto(null);
        if (dir === null) return false;
        if (files.length) void drop(files, dir);
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
