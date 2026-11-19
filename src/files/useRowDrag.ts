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
import { canMoveInto, failureText } from "./tree-shared";
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

/** A row dragged onto a folder moves into it; a file dragged over the
 *  documents opens there; Esc or a cancelled pointer drops nothing.
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
      /** The tree's box as the drag began: off it, nothing to hit-test. */
      let treeBox: DOMRect | null = null;
      let into: string | null = null;
      const ghost = { current: null as ReturnType<typeof dragGhost> | null };
      const targetAt = (x: number, y: number) => {
        treeBox ??= treeRef.current?.getBoundingClientRect() ?? null;
        const over =
          treeBox &&
          x >= treeBox.left &&
          x <= treeBox.right &&
          y >= treeBox.top &&
          y <= treeBox.bottom;
        if (!over) return null;
        const el = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-drop-dir]");
        const dir = el?.dataset.dropDir;
        return dir && treeRef.current?.contains(el) && fits(dir) ? dir : null;
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
          if (!into && !isDir && !group) documentDrop()?.over(x, y, m.shiftKey);
          else documentDrop()?.leave();
        },
        end: (x, y, dropped, up) => {
          edge.stop();
          ghost.current?.remove();
          setDragging(false);
          setDrag(null);
          documentDrop()?.leave();
          if (!dropped) return;
          if (!into && !isDir && !group)
            documentDrop()?.drop(path, x, y, up?.shiftKey ?? false);
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
          held: (x, y) => latest.current.onHeld({ x, y }, path, isDir),
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
