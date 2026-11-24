import { useEffect, useMemo, type RefObject } from "react";
import { showMessage } from "../engine/controls/app-dialog";
import { hasNativeMenuBar } from "../platform/capabilities";
import { useSettings } from "../prefs/SettingsContext";
import { FOCUSED_EDIT_EVENT } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { basename } from "../utils/path";
import { comboFromEvent } from "../utils/shortcuts";
import { canUndo, fileUndoStack, undoStep, type FileStep } from "./file-undo";
import { failureText, trashFromTree } from "./tree-shared";

/**
 * The tree's file operations, taken back newest first with Edit › Undo
 * while the tree has the keyboard, or the Undo on the operation's notice;
 * a step whose entries changed since is refused, and nothing is undone.
 * `record` keeps a step and returns its notice's Undo, if it has one.
 */
export function useFileUndo(
  treeRef: RefObject<HTMLDivElement | null>,
  /** The folder open in the window: what is trashed stays inside it. */
  folder: string | null,
  reload: (...dirs: string[]) => void,
) {
  const { t } = useSettings();
  const stack = useMemo(() => fileUndoStack(), []);
  const latest = useLatest({ t, folder, reload });

  const undo = useMemo(
    () =>
      (which?: FileStep): boolean => {
        const step = stack.take(which);
        const { t, folder, reload } = latest.current;
        if (!step || !folder) return false;
        void undoStep(step, {
          trash: (path) => trashFromTree(path, folder, reload),
        }).then(
          async (result) => {
            if (result.done) return;
            const names = result.changed.map(basename).join("\n");
            await showMessage(`${t.treeCopyUndoChanged}\n\n${names}`);
          },
          (err: unknown) => showMessage(failureText(t, err, "")),
        );
        return true;
      },
    [stack, latest],
  );

  // Another folder: its steps were in the one before.
  useEffect(() => () => stack.clear(), [folder, stack]);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const onEdit = (e: Event) => {
      if ((e as CustomEvent<string>).detail === "undo" && undo())
        e.preventDefault();
    };
    // A Mac's menu takes ⌘Z and comes back through FOCUSED_EDIT_EVENT; the
    // other systems' menus miss it while the page has the keyboard.
    const onKey = (e: KeyboardEvent) => {
      if (!hasNativeMenuBar && comboFromEvent(e) === "mod+z" && undo())
        e.preventDefault();
    };
    tree.addEventListener(FOCUSED_EDIT_EVENT, onEdit);
    tree.addEventListener("keydown", onKey);
    return () => {
      tree.removeEventListener(FOCUSED_EDIT_EVENT, onEdit);
      tree.removeEventListener("keydown", onKey);
    };
  }, [treeRef, undo]);

  return useMemo(
    () => ({
      record(step: FileStep) {
        if (!canUndo(step)) return undefined;
        stack.push(step);
        return { label: latest.current.t.menuUndo, run: () => void undo(step) };
      },
    }),
    [stack, latest, undo],
  );
}
