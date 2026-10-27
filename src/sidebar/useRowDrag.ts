import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { fs } from "../platform/ipc";
import type { Strings } from "../i18n/strings";
import { showMessage } from "../ui/app-dialog";
import { documentDrop, setDragging } from "../ui/document-drop";
import { basename, parentDir } from "../utils/path";
import { canMoveInto, DRAG_START_PX, failureText } from "./tree-shared";

/** A row being dragged, and the folder under the pointer. */
export interface Drag {
  path: string;
  name: string;
  isDir: boolean;
  x: number;
  y: number;
  /** The folder it would go into; null over nowhere it can go. */
  into: string | null;
}

/** A row dragged onto a folder moves into it; a file dragged over the
 *  documents opens there. Pointer events, not HTML drag and drop, which the
 *  OS file drop takes over on Windows. */
export function useRowDrag(
  treeRef: RefObject<HTMLDivElement | null>,
  reload: (...dirs: string[]) => void,
  onEntryMoved: (from: string, to: string) => void,
  t: Strings,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragClick = useRef(false);
  const pressed = useRef<{
    path: string;
    name: string;
    isDir: boolean;
    x: number;
    y: number;
  } | null>(null);
  const onRowPointerDown = useCallback(
    (e: ReactPointerEvent, path: string, name: string, isDir: boolean) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      pressed.current = { path, name, isDir, x: e.clientX, y: e.clientY };
    },
    [],
  );
  useEffect(() => {
    const targetAt = (x: number, y: number, path: string, isDir: boolean) => {
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-drop-dir]");
      const into = el?.dataset.dropDir;
      return into &&
        treeRef.current?.contains(el) &&
        canMoveInto(path, isDir, into)
        ? into
        : null;
    };
    let current: Drag | null = null;
    const show = (next: Drag | null) => {
      if (!current !== !next) setDragging(!!next);
      current = next;
      setDrag(next);
    };
    const onMove = (e: PointerEvent) => {
      const start = pressed.current;
      if (!start) return;
      if (
        !current &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START_PX
      )
        return;
      const into = targetAt(e.clientX, e.clientY, start.path, start.isDir);
      show({
        path: start.path,
        name: start.name,
        isDir: start.isDir,
        x: e.clientX,
        y: e.clientY,
        into,
      });
      if (!into && !start.isDir) documentDrop()?.over(e.clientX, e.clientY);
      else documentDrop()?.leave();
    };
    const end = (e: PointerEvent) => {
      pressed.current = null;
      const dropped = current;
      if (!dropped) return;
      show(null);
      documentDrop()?.leave();
      if (!dropped.into && !dropped.isDir && e.type === "pointerup")
        documentDrop()?.drop(dropped.path, e.clientX, e.clientY);
      dragClick.current = true;
      // A click may not follow (released outside the row).
      window.setTimeout(() => (dragClick.current = false), 0);
      if (dropped.into) void move(dropped.path, dropped.into);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pressed.current) return;
      pressed.current = null;
      show(null);
      documentDrop()?.leave();
    };
    const move = async (from: string, into: string) => {
      try {
        const to = await fs.moveEntry(from, into);
        reload(parentDir(from) ?? into, into);
        onEntryMoved(from, to);
      } catch (err) {
        await showMessage(failureText(t, err, basename(from)));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey);
    };
  }, [treeRef, reload, onEntryMoved, t]);

  const takeDragClick = useCallback(() => {
    const taken = dragClick.current;
    dragClick.current = false;
    return taken;
  }, []);
  return { drag, onRowPointerDown, takeDragClick };
}
