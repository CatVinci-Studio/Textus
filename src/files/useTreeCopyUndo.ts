import { useEffect, useMemo, type RefObject } from "react";
import { showMessage } from "../engine/controls/app-dialog";
import { hasNativeMenuBar } from "../platform/capabilities";
import { useSettings } from "../prefs/SettingsContext";
import { FOCUSED_EDIT_EVENT } from "../utils/events";
import { useLatest } from "../utils/hooks/useLatest";
import { basename } from "../utils/path";
import { comboFromEvent } from "../utils/shortcuts";
import { lastDrop, undoCopies, type CopiedEntry } from "./tree-copy-undo";
import { failureText, trashable, trashFromTree } from "./tree-shared";

/**
 * The last drop of files from a file manager, undone with Edit › Undo while
 * the tree has the keyboard, or the Undo on its notice: its copies to the
 * Trash, never what was there before, and none when one changed since.
 * `remember` keeps a drop and returns its notice's Undo, if it has one.
 */
export function useTreeCopyUndo(
  treeRef: RefObject<HTMLDivElement | null>,
  /** The folder open in the window, the copies' root. */
  folder: string | null,
  reload: (...dirs: string[]) => void,
) {
  const { t } = useSettings();
  const drop = useMemo(() => lastDrop(), []);
  const latest = useLatest({ t, folder, reload });

  const undo = useMemo(
    () =>
      (which?: readonly CopiedEntry[]): boolean => {
        const copies = drop.take(which);
        const { t, folder, reload } = latest.current;
        if (!copies || !folder) return false;
        void undoCopies(copies, (path) =>
          trashFromTree(path, folder, reload),
        ).then(
          async (result) => {
            if (result.done) return;
            const names = result.changed.map(basename).join("\n");
            await showMessage(`${t.treeCopyUndoChanged}\n\n${names}`);
          },
          (err: unknown) => showMessage(failureText(t, err, "")),
        );
        return true;
      },
    [drop, latest],
  );

  // Another folder: the last drop was into the one before.
  useEffect(() => () => drop.keep(null), [folder, drop]);

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
      remember(copies: readonly CopiedEntry[]) {
        // Without a Trash an undo would delete for good: none offered.
        const kept = copies.every((c) => trashable(c.path)) ? copies : null;
        drop.keep(kept);
        if (!kept?.length) return undefined;
        return {
          label: latest.current.t.menuUndo,
          run: () => void undo(kept),
        };
      },
    }),
    [drop, latest, undo],
  );
}
