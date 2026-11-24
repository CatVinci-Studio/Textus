import { useCallback, useState } from "react";
import { fs } from "../platform/ipc";
import { announceFileCreated } from "../utils/events";
import { isInside, parentDir } from "../utils/path";

import { showMessage } from "../engine/controls/app-dialog";
import type { Strings } from "../i18n/strings";
import { failureText, type TreeDraft } from "./tree-shared";

/** The document or folder being named in place, and making it once
 *  named (a document opens). */
export function useNewEntry(
  t: Strings,
  reload: (...dirs: string[]) => void,
  onFileSelect: (path: string) => void,
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
        // A name with slashes made folders on the way: they open too.
        const dirs = [];
        for (
          let d = parentDir(made);
          d && isInside(d, draft.dir);
          d = parentDir(d)
        )
          dirs.push(d);
        reload(draft.dir, ...dirs);
        if (draft.kind === "document") {
          announceFileCreated(made);
          onFileSelect(made);
        }
      } catch (err) {
        await showMessage(failureText(t, err, name));
      }
    },
    [draft, t, reload, onFileSelect],
  );
  return { draft, setDraft, finishDraft };
}
