import { useEffect, useMemo, type RefObject } from "react";
import { showMessage } from "../engine/controls/app-dialog";
import { hasNativeMenuBar } from "../platform/capabilities";
import { fs } from "../platform/ipc";
import { useSettings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import {
  FILE_WRITTEN_EVENT,
  FOCUSED_EDIT_EVENT,
  sendAppEvent,
} from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { basename, parentDir } from "../utils/path";
import { comboFromEvent } from "../utils/shortcuts";
import {
  canUndo,
  fileUndoStack,
  undoStep,
  type FileStep,
  type UndoRefusal,
} from "./file-undo";
import { revertEdits } from "./move-links";
import { failureText, trashFromTree } from "./tree-shared";
import { keepKeyboardOn, rowBeside } from "./tree-reveal";

/** What a refusal says, before the entries it names. */
const REFUSED: Record<UndoRefusal, (t: Strings) => string> = {
  changed: (t) => t.treeUndoChanged,
  gone: (t) => t.treeUndoGone,
  taken: (t) => t.treeUndoTaken,
};

/** The tree's keys that take back or do again, where no menu took them. */
const KEYS: Record<string, "undo" | "redo"> = {
  "mod+z": "undo",
  "mod+shift+z": "redo",
  "mod+y": "redo",
};

const onRow = (e: Event) =>
  (e.target as HTMLElement | null)?.getAttribute?.("role") === "treeitem";

/**
 * The tree's file operations, taken back newest first with Edit › Undo
 * while the tree has the keyboard, or the Undo on the operation's notice,
 * and done again with Edit › Redo; a step whose entries changed since, or
 * whose old place is taken, is refused, and nothing is undone. `record`
 * keeps a step and returns its notice's Undo, if it has one.
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
  const stack = useMemo(() => fileUndoStack(), []);
  const latest = useLatest({ t, folder, reload, onEntryMoved });

  const run = useMemo(
    () =>
      (step: FileStep, done: (again: FileStep) => void): void => {
        const { t, folder, reload, onEntryMoved } = latest.current;
        // What a step made goes when taken back: the keyboard goes beside.
        const near =
          step.kind === "made"
            ? rowBeside(
                treeRef.current,
                step.made.map((m) => m.path),
              )
            : null;
        void undoStep(step, {
          trash: (path) => trashFromTree(path, folder, reload),
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
        }).then(
          async (result) => {
            if (result.done) {
              if (result.redo) done(result.redo);
              keepKeyboardOn(treeRef.current, result.show ?? near);
              return;
            }
            const names = result.paths.map(basename).join("\n");
            await showMessage(`${REFUSED[result.reason](t)}\n\n${names}`);
          },
          (err: unknown) => showMessage(failureText(t, err, "")),
        );
      },
    [latest, treeRef],
  );

  const act = useMemo(
    () => ({
      undo(which?: FileStep): boolean {
        const step = stack.take(which);
        if (!step) return false;
        run(step, (redo) => stack.undone(redo));
        return true;
      },
      redo(): boolean {
        const step = stack.takeRedo();
        if (!step) return false;
        run(step, (undo) => stack.redone(undo));
        return true;
      },
    }),
    [stack, run],
  );

  // Another folder: its steps were in the one before.
  useEffect(() => () => stack.clear(), [folder, stack]);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if ((detail === "undo" || detail === "redo") && onRow(e) && act[detail]())
        e.preventDefault();
    };
    // A Mac's menu takes ⌘Z and comes back through FOCUSED_EDIT_EVENT; the
    // other systems' menus miss it while the page has the keyboard.
    const onKey = (e: KeyboardEvent) => {
      const key = KEYS[comboFromEvent(e) ?? ""];
      if (!hasNativeMenuBar && key && onRow(e) && act[key]())
        e.preventDefault();
    };
    tree.addEventListener(FOCUSED_EDIT_EVENT, onEdit);
    tree.addEventListener("keydown", onKey);
    return () => {
      tree.removeEventListener(FOCUSED_EDIT_EVENT, onEdit);
      tree.removeEventListener("keydown", onKey);
    };
  }, [treeRef, act]);

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
    }),
    [stack, latest, act, treeRef],
  );
}

export type FileUndo = ReturnType<typeof useFileUndo>;
