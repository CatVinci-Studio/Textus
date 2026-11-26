import {
  useCallback,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { documentDrop, setDragging } from "../engine/controls/document-drop";
import { canTakeInto, dropDirAt } from "./tree-shared";
import { dragGhost } from "../engine/drag/ghost";
import { trackDrag } from "../engine/drag/pointer-drag";
import { holdToDrag } from "../engine/drag/hold-drag";
import { useLatest } from "../utils/hooks/useLatest";
import { edgeScroll } from "../engine/drag/edge-scroll";
import { canDragFilesOut } from "../platform/capabilities";
import { copyKey, dragOut, LEAVE_AFTER_MS, outsideWindow } from "./drag-out";
import { isFarUrl } from "../platform/far-files";
import { outermost, type TreeSelection } from "./tree-selection";
import type { TreeTransfer } from "./useTreeTransfer";

/** A row being dragged (or the first of several picked), and the folder
 *  under the pointer. */
interface Drag {
  path: string;
  isDir: boolean;
  /** The folder it would go into; null over nowhere it can go. */
  into: string | null;
}

/** No text selected while a row is held: dragged over the documents, the
 *  press would otherwise select everything it passes. Returns the end of
 *  it, for a press whose release the page never hears. */
function holdSelection(): () => void {
  const stop = (e: Event) => e.preventDefault();
  const done = () => {
    window.removeEventListener("selectstart", stop);
    window.removeEventListener("pointerup", done);
    window.removeEventListener("pointercancel", done);
  };
  window.addEventListener("selectstart", stop);
  window.addEventListener("pointerup", done);
  window.addEventListener("pointercancel", done);
  return done;
}

const HELD: Record<"Shift" | "Alt" | "Control", (e: KeyboardEvent) => boolean> =
  {
    Shift: (e) => e.shiftKey,
    Alt: (e) => e.altKey,
    Control: (e) => e.ctrlKey,
  };

/** Whether `key` is held while a row is dragged: pressed or let go with
 *  the pointer still, `changed` shows what the drop would do now. */
function heldKey(key: keyof typeof HELD, changed: (held: boolean) => void) {
  const state = {
    held: false,
    stop: () => {
      window.removeEventListener("keydown", on, true);
      window.removeEventListener("keyup", on, true);
    },
  };
  const on = (e: KeyboardEvent) => {
    if (e.key !== key || HELD[key](e) === state.held) return;
    state.held = HELD[key](e);
    changed(state.held);
  };
  window.addEventListener("keydown", on, true);
  window.addEventListener("keyup", on, true);
  return state;
}

/** A row dragged onto a folder moves into it, or with ⌥ (Ctrl elsewhere)
 *  held is copied there; files dragged over the
 *  documents go into one or open there (file-drop-session.ts); Esc or a cancelled pointer drops nothing.
 *  Pointer events, not HTML drag and drop, which the OS file drop takes
 *  over on Windows. */
export function useRowDrag(
  treeRef: RefObject<HTMLDivElement | null>,
  /** Rows picked together: a press on one of them drags them all. */
  selection: TreeSelection,
  /** A finger's hold let go where it was: the row's menu. */
  onHeld: (at: { x: number; y: number }, path: string, isDir: boolean) => void,
  /** Moves or copies rows into a folder (useTreeTransfer). */
  transfer: TreeTransfer["transfer"],
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useLatest({ onHeld, transfer });

  const onRowPointerDown = useCallback(
    (e: ReactPointerEvent, path: string, name: string, isDir: boolean) => {
      if (e.button !== 0) return;
      // A modified press is a pick (tree-selection.ts), not a drag.
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      const unhold = holdSelection();
      const group = selection.groupOf(path);
      const moving = outermost(selection.rowsFor(path, isDir));
      const fits = (dir: string) => canTakeInto(moving, dir, !!copy?.held);
      // Files, not folders, go into the documents or open there.
      const files = moving.every((row) => !row.isDir)
        ? moving.map((row) => ({ path: row.path, isDir: false }))
        : null;
      let shift: ReturnType<typeof heldKey> | null = null;
      let copy: ReturnType<typeof heldKey> | null = null;
      // No Shift under a finger, and no other way yet to choose: a file
      // a finger drags onto the documents opens there, as it always has.
      const opens = e.pointerType === "touch";
      // A mouse taking the rows out of the window hands them to the
      // system's drag: real files for a file manager or another app.
      const outward =
        canDragFilesOut &&
        e.pointerType === "mouse" &&
        !moving.some((row) => isFarUrl(row.path));
      let tracked: { cancel: () => void } | null = null;
      /** Set while the pointer is past the window, to take the rows out. */
      let leaving: number | undefined;
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
          shift = heldKey("Shift", (held) => {
            if (files && !into)
              documentDrop()?.over(files, last.x, last.y, held || opens);
          });
          copy = heldKey(copyKey(), (held) => {
            document.body.classList.toggle("tree-drag-copy", held);
            const next = targetAt(last.x, last.y);
            if (next !== into) setDrag({ path, isDir, into: next });
            into = next;
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
          if (outward && outsideWindow(x, y)) {
            leaving ??= window.setTimeout(() => {
              tracked?.cancel();
              unhold();
              void dragOut(moving);
            }, LEAVE_AFTER_MS);
            return;
          }
          window.clearTimeout(leaving);
          leaving = undefined;
          ghost.current?.move(x, y);
          last = { x, y };
          const box = treeRef.current?.getBoundingClientRect();
          if (box && x >= box.left && x <= box.right) edge.at(y);
          else edge.stop();
          if (
            copy &&
            copy.held !== (copyKey() === "Alt" ? m.altKey : m.ctrlKey)
          ) {
            copy.held = !copy.held;
            document.body.classList.toggle("tree-drag-copy", copy.held);
          }
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
          window.clearTimeout(leaving);
          edge.stop();
          shift?.stop();
          copy?.stop();
          document.body.classList.remove("tree-drag-copy");
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
          void latest.current.transfer(
            moving,
            into,
            copy?.held ? "copy" : "move",
          );
        },
      } satisfies Parameters<typeof trackDrag>[1];
      // A finger lifts the row by holding still; a move before that scrolls.
      if (e.pointerType === "touch")
        holdToDrag(e.nativeEvent, {
          ...handlers,
          lift: handlers.start,
          held: (x, y) => {
            shift?.stop();
            copy?.stop();
            latest.current.onHeld({ x, y }, path, isDir);
          },
        });
      else tracked = trackDrag(e.nativeEvent, handlers);
    },
    [treeRef, selection, latest],
  );

  return { drag, onRowPointerDown };
}
