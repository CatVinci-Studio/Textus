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
import { useLatest } from "../utils/hooks/useLatest";

/** A row being dragged, and the folder under the pointer. */
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
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useLatest({ reload, onEntryMoved, linkBase, t });

  const onRowPointerDown = useCallback(
    (e: ReactPointerEvent, path: string, name: string, isDir: boolean) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      holdSelection();
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
        return dir &&
          treeRef.current?.contains(el) &&
          canMoveInto(path, isDir, dir)
          ? dir
          : null;
      };
      trackDrag(e.nativeEvent, {
        start: () => {
          setDragging(true);
          // The copy under the pointer, as every drag elsewhere has it.
          ghost.current = dragGhost(name, "tree-drag-ghost floating-surface");
          setDrag({ path, isDir, into: null });
        },
        move: (x, y, m) => {
          ghost.current?.move(x, y);
          const next = targetAt(x, y);
          // The tree redraws only when where it would land changes.
          if (next !== into) setDrag({ path, isDir, into: next });
          into = next;
          if (!into && !isDir) documentDrop()?.over(x, y, m.shiftKey);
          else documentDrop()?.leave();
        },
        end: (x, y, dropped, up) => {
          ghost.current?.remove();
          setDragging(false);
          setDrag(null);
          documentDrop()?.leave();
          if (!dropped) return;
          if (!into && !isDir)
            documentDrop()?.drop(path, x, y, up?.shiftKey ?? false);
          if (into) void move(path, into);
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- move reads latest
    [treeRef],
  );

  const move = async (from: string, into: string) => {
    const { reload, onEntryMoved, linkBase, t } = latest.current;
    try {
      const to = await fs.moveEntry(from, into);
      reload(parentDir(from) ?? into, into);
      onEntryMoved(from, to);
      void updateLinksAfterMove(from, to, linkBase, t);
    } catch (err) {
      await showMessage(failureText(t, err, basename(from)));
    }
  };
  return { drag, onRowPointerDown };
}
