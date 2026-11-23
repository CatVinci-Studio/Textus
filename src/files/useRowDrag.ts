import {
  useCallback,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { fs } from "../platform/ipc";
import type { Strings } from "../i18n/strings";
import { showMessage } from "../engine/controls/app-dialog";
import { documentDrop, setDragging } from "../engine/controls/document-drop";
import { basename, parentDir } from "../utils/path";
import { updateLinksAfterMove } from "./move-links";
import { canMoveInto, dropDirAt, failureText } from "./tree-shared";
import { dragGhost } from "../engine/drag/ghost";
import { trackDrag } from "../engine/drag/pointer-drag";
import { holdToDrag } from "../engine/drag/hold-drag";
import { useLatest } from "../utils/hooks/useLatest";
import { edgeScroll } from "../engine/drag/edge-scroll";
import { outermost, type TreeRow, type TreeSelection } from "./tree-selection";

/** A row being dragged (or the first of several picked), and the folder
 *  under the pointer. */
interface Drag {
  path: string;
  isDir: boolean;
  /** The folder it would go into; null over nowhere it can go. */
  into: string | null;
}

/** No text selected while a row is held: dragged over the documents, the
 *  press would otherwise select everything it passes. */
function holdSelection(): void {
  const stop = (e: Event) => e.preventDefault();
  const done = () => {
    window.removeEventListener("selectstart", stop);
    window.removeEventListener("pointerup", done);
    window.removeEventListener("pointercancel", done);
  };
  window.addEventListener("selectstart", stop);
  window.addEventListener("pointerup", done);
  window.addEventListener("pointercancel", done);
}

/** Whether Shift is held while a row is dragged: pressed or let go with
 *  the pointer still, `changed` shows what the drop would do now. */
function heldShift(changed: (held: boolean) => void) {
  const state = {
    held: false,
    stop: () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
    },
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Shift" || e.shiftKey === state.held) return;
    state.held = e.shiftKey;
    changed(state.held);
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("keyup", key, true);
  return state;
}

/** A row dragged onto a folder moves into it; files dragged over the
 *  documents go into one or open there (file-drop-session.ts); Esc or a cancelled pointer drops nothing.
 *  Pointer events, not HTML drag and drop, which the OS file drop takes
 *  over on Windows. */
export function useRowDrag(
  treeRef: RefObject<HTMLDivElement | null>,
  reload: (...dirs: string[]) => void,
  onEntryMoved: (from: string, to: string) => void,
  /** The folder whose documents' links follow a move. */
  linkBase: string,
  t: Strings,
  /** Rows picked together: a press on one of them drags them all. */
  selection: TreeSelection,
  /** A finger's hold let go where it was: the row's menu. */
  onHeld: (at: { x: number; y: number }, path: string, isDir: boolean) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useLatest({ reload, onEntryMoved, linkBase, t, onHeld });

  const onRowPointerDown = useCallback(
    (e: ReactPointerEvent, path: string, name: string, isDir: boolean) => {
      if (e.button !== 0) return;
      // A modified press is a pick (tree-selection.ts), not a drag.
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      holdSelection();
      const group = selection.groupOf(path);
      const moving: TreeRow[] = group ? outermost(group) : [{ path, isDir }];
      const fits = (dir: string) =>
        moving.every((row) => canMoveInto(row.path, row.isDir, dir));
      // Files, not folders, go into the documents or open there.
      const files = moving.every((row) => !row.isDir)
        ? moving.map((row) => ({ path: row.path, isDir: false }))
        : null;
      let shift: ReturnType<typeof heldShift> | null = null;
      // No Shift under a finger, and no other way yet to choose: a file
      // a finger drags onto the documents opens there, as it always has.
      const opens = e.pointerType === "touch";
      /** The tree's box as the drag began: off it, nothing to hit-test. */
      let treeBox: DOMRect | null = null;
      let into: string | null = null;
      const ghost = { current: null as ReturnType<typeof dragGhost> | null };
      const targetAt = (x: number, y: number) => {
        treeBox ??= treeRef.current?.getBoundingClientRect() ?? null;
        const dir = dropDirAt(treeRef.current, x, y, treeBox);
        return dir && fits(dir) ? dir : null;
      };
      // Near the tree's top or bottom it scrolls on while the pointer rests
      // there, over the tree.
      let last = { x: 0, y: 0 };
      const edge = edgeScroll(
        () => treeRef.current?.closest<HTMLElement>(".sidebar-body") ?? null,
        () => {
          const next = targetAt(last.x, last.y);
          if (next !== into) setDrag({ path, isDir, into: next });
          into = next;
        },
      );
      const handlers = {
        start: () => {
          shift = heldShift((held) => {
            if (files && !into)
              documentDrop()?.over(files, last.x, last.y, held || opens);
          });
          setDragging(true);
          // The copy under the pointer, as every drag elsewhere has it.
          ghost.current = dragGhost(
            group ? `${name} +${group.length - 1}` : name,
            "tree-drag-ghost floating-surface",
          );
          setDrag({ path, isDir, into: null });
        },
        move: (x, y, m) => {
          ghost.current?.move(x, y);
          last = { x, y };
          const box = treeRef.current?.getBoundingClientRect();
          if (box && x >= box.left && x <= box.right) edge.at(y);
          else edge.stop();
          const next = targetAt(x, y);
          // The tree redraws only when where it would land changes.
          if (next !== into) setDrag({ path, isDir, into: next });
          into = next;
          if (shift) shift.held = m.shiftKey;
          if (!into && files)
            documentDrop()?.over(files, x, y, m.shiftKey || opens);
          else documentDrop()?.leave();
        },
        end: (x, y, dropped, up) => {
          edge.stop();
          shift?.stop();
          ghost.current?.remove();
          setDragging(false);
          setDrag(null);
          // Let go over the documents, what they showed becomes the drop.
          const onDocuments = dropped && !into && files;
          if (!onDocuments) documentDrop()?.leave();
          if (!dropped) return;
          if (onDocuments)
            documentDrop()?.drop(
              files,
              x,
              y,
              (up?.shiftKey ?? shift?.held ?? false) || opens,
            );
          if (!into) return;
          if (group) selection.clear();
          void moveAll(moving, into);
        },
      } satisfies Parameters<typeof trackDrag>[1];
      // A finger lifts the row by holding still; a move before that scrolls.
      if (e.pointerType === "touch")
        holdToDrag(e.nativeEvent, {
          ...handlers,
          lift: handlers.start,
          held: (x, y) => {
            shift?.stop();
            latest.current.onHeld({ x, y }, path, isDir);
          },
        });
      else trackDrag(e.nativeEvent, handlers);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moveAll reads latest
    [treeRef, selection],
  );

  const moveAll = async (rows: readonly TreeRow[], into: string) => {
    const { reload, onEntryMoved, linkBase, t } = latest.current;
    for (const { path: from } of rows) {
      try {
        const to = await fs.moveEntry(from, into);
        reload(parentDir(from) ?? into, into);
        onEntryMoved(from, to);
        void updateLinksAfterMove(from, to, linkBase, t);
      } catch (err) {
        await showMessage(failureText(t, err, basename(from)));
        return;
      }
    }
  };
  return { drag, onRowPointerDown };
}
