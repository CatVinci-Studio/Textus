import { useCallback, useState } from "react";
import { fs } from "../platform/ipc";
import { announceFileCreated } from "../utils/events";

import { showMessage } from "../engine/controls/app-dialog";
import type { Strings } from "../i18n/strings";
import { failureText, type TreeDraft } from "./tree-shared";
import { stampOf } from "./file-undo";
import type { FileUndo } from "./useFileUndo";

/** The document or folder being named in place, and making it once
 *  named (a document opens). */
export function useNewEntry(
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string) => void,
  fileUndo: FileUndo,
) {
  const [draft, setDraft] = useState<TreeDraft | null>(null);
  const finishDraft = useCallback(
    async (name: string | null) => {
      setDraft(null);
      if (!draft || !name) return;
      try {
        const made =
          draft.kind === "document"
            ? await fs.createDocument(draft.dir, name)
            : await fs.createFolder(draft.dir, name);
        reload(draft.dir);
        const isDir = draft.kind === "folder";
        const stamp = await stampOf(made, isDir).catch(() => null);
        if (stamp !== null)
          fileUndo.record({
            kind: "made",
            made: [{ path: made, isDir, stamp }],
          });
        if (isDir) fileUndo.show(made);
        else {
          announceFileCreated(made);
          onFileSelect(made);
        }
      } catch (err) {
        await showMessage(failureText(t, err, name));
      }
    },
    [draft, t, reload, onFileSelect, fileUndo],
  );
  return { draft, setDraft, finishDraft };
}
