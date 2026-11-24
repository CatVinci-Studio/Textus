import { useMemo, type RefObject } from "react";
import { showMessage } from "../engine/controls/app-dialog";
import { fs } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import { FILE_WRITTEN_EVENT, sendAppEvent } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { basename, parentDir } from "../utils/path";
import {
  canUndo,
  undoStep,
  type FileStep,
  type UndoRefusal,
} from "./file-undo";
import { windowFileUndo, type StepRun } from "./file-undo-stack";
import { revertEdits } from "./move-links";
import { failureText, trashFromTree } from "./tree-shared";
import { keepKeyboardOn, rowBeside } from "./tree-reveal";

/** What a refusal says, before the entries it names. */
const REFUSED: Record<UndoRefusal, (t: Strings) => string> = {
  changed: (t) => t.treeUndoChanged,
  gone: (t) => t.treeUndoGone,
  taken: (t) => t.treeUndoTaken,
};

/**
 * The tree's file operations, taken back newest first with Edit › Undo
 * while the tree has the keyboard (useTreeCommands.ts), or the Undo on the
 * operation's notice, and done again with Edit › Redo; a step whose
 * entries changed since, or whose old place is taken, is refused, and
 * nothing is undone. The steps are the window's (file-undo-stack.ts).
 * `record` keeps a step and returns its notice's Undo, if it has one.
 */
export function useFileUndo(
  treeRef: RefObject<HTMLDivElement | null>,
  /** The folder the tree shows: what is trashed stays inside it, and its
   *  documents' links follow a move. */
  folder: string,
  reload: (...dirs: string[]) => void,
  onEntryMoved: (from: string, to: string) => void,
) {
  const { t } = useSettings();
  const stack = windowFileUndo;
  const latest = useLatest({ t, folder, reload, onEntryMoved });

  const run = useMemo(
    () =>
      async (step: FileStep): Promise<StepRun> => {
        const { t, folder, reload, onEntryMoved } = latest.current;
        // What a step made goes when taken back: the keyboard goes beside.
        const near =
          step.kind === "made"
            ? rowBeside(
                treeRef.current,
                step.made.map((m) => m.path),
              )
            : null;
        try {
          const result = await undoStep(step, {
            trash: (paths) => trashFromTree(paths, folder, reload),
            putBack: async (place, path) => {
              await fs.putBack(place, path);
              reload(parentDir(path) ?? folder);
              sendAppEvent(FILE_WRITTEN_EVENT, path);
            },
            move: async (from, to) => {
              const into = parentDir(to) ?? folder;
              const moved = await fs.moveEntry(from, into, basename(to));
              reload(parentDir(from) ?? folder, into);
              onEntryMoved(from, moved);
            },
            revertEdits: (edits, moved) => revertEdits(edits, moved, t),
          });
          if (result.done) {
            keepKeyboardOn(treeRef.current, result.show ?? near);
            return { done: true, again: result.redo };
          }
          const names = result.paths.map(basename).join("\n");
          void showMessage(`${REFUSED[result.reason](t)}\n\n${names}`);
        } catch (err) {
          void showMessage(failureText(t, err, ""));
        }
        return { done: false };
      },
    [latest, treeRef],
  );

  const act = useMemo(
    () => ({
      /** Takes back the newest step, or only `which`; false with none. */
      undo: (which?: FileStep): boolean => stack.undo(run, which),
      redo: (): boolean => stack.redo(run),
    }),
    [stack, run],
  );

  return useMemo(
    () => ({
      /** Keeps `step` to take back; returns the Undo for its notice. */
      record(step: FileStep) {
        if (!canUndo(step)) return undefined;
        stack.push(step);
        return {
          label: latest.current.t.menuUndo,
          run: () => void act.undo(step),
        };
      },
      /** The keyboard on the row of `path` (made, moved, renamed), so
       *  Undo then reaches the tree. */
      show(path: string | null) {
        keepKeyboardOn(treeRef.current, path);
      },
      /** The row beside the rows of `paths`, to show once they go. */
      rowBeside: (paths: readonly string[]) =>
        rowBeside(treeRef.current, paths),
      act,
    }),
    [stack, latest, act, treeRef],
  );
}

export type FileUndo = ReturnType<typeof useFileUndo>;
