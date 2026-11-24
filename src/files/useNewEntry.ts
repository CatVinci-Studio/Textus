import { useCallback, useState } from "react";
import { fs } from "../platform/ipc";
import { announceFileCreated } from "../utils/events";
import { isInside, parentDir } from "../utils/path";

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
    async (name: string | null, byKey: boolean): Promise<string | null> => {
      if (!draft || !name) {
        setDraft(null);
        if (byKey) fileUndo.show(null);
        return null;
      }
      try {
        const made =
          draft.kind === "document"
            ? await fs.createDocument(draft.dir, name)
            : await fs.createFolder(draft.dir, name);
        setDraft(null);
        // A name with slashes made folders on the way: they open too.
        const dirs = [];
        for (
          let d = parentDir(made);
          d && isInside(d, draft.dir);
          d = parentDir(d)
        )
          dirs.push(d);
        reload(draft.dir, ...dirs);
        const isDir = draft.kind === "folder";
        const stamp = await stampOf(made, isDir).catch(() => null);
        if (stamp !== null)
          fileUndo.record({
            kind: "made",
            made: [{ path: made, isDir, stamp }],
          });
        if (isDir) {
          if (byKey) fileUndo.show(made);
        } else {
          announceFileCreated(made);
          onFileSelect(made);
        }
        return null;
      } catch (err) {
        return failureText(t, err, name);
      }
    },
    [draft, t, reload, onFileSelect, fileUndo],
  );
  return { draft, setDraft, finishDraft };
}
