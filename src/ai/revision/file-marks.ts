import { provideFileMarks, type FileMark } from "../../registry/file-marks";
import { onChangedFiles, changedFilesNow } from "../chat/file-changes";
import { aiFileMarksNow, onAiFileMarks } from "./file-revisions";

/** Textus AI's marks on the folder's files, for their rows: what it
 *  changed, and what waits for the writer there. */
export function provideAiFileMarks(): void {
  provideFileMarks({
    subscribe: (listener) => {
      const a = onChangedFiles(listener);
      const b = onAiFileMarks(listener);
      return () => {
        a();
        b();
      };
    },
    markOf: (path): FileMark | null => {
      const mark = aiFileMarksNow()[path];
      const changed = changedFilesNow().has(path) || !!mark;
      return changed
        ? { changed, pending: mark?.pending, created: mark?.created }
        : null;
    },
  });
}
