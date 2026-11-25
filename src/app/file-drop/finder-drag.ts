import { listenToThisWebview, unlistenAll } from "../../platform/events";
import { windowIpc } from "../../platform/ipc";
import { isWindowsPlatform } from "../../platform/os";
import type { DraggedFile } from "../../engine/controls/document-drop";
import { dropPointInPage } from "../dropped-files";
import { isDraggingOut } from "../../files/drag-out";

type Point = { x: number; y: number };

/** What the system's drag events carry: the paths on entering and on the
 *  drop, the pointer (physical pixels on Windows) throughout. */
interface DragPayload {
  paths?: string[];
  position: Point;
}

interface SystemDrag {
  over(files: readonly DraggedFile[], at: Point, shift: boolean): void;
  leave(): void;
  drop(files: readonly DraggedFile[], at: Point, shift: boolean): void;
}

/**
 * Files dragged over the window from a file manager, through Tauri's drag
 * events: the paths come on entering, which of them are folders soon
 * after. The page hears no keys meanwhile, so Shift is asked of the system
 * (`drag_modifiers`), at most once a frame, and again on the drop. Each
 * answer is dropped if the drag has moved on by then.
 */
export function watchSystemDrags(
  to: SystemDrag,
  isFolder: (path: string) => Promise<boolean>,
): () => void {
  let drag = 0;
  let files: Promise<DraggedFile[]> = Promise.resolve([]);
  let frame = 0;
  let at: Point = { x: 0, y: 0 };
  const point = (p: Point) =>
    dropPointInPage(p, isWindowsPlatform(), window.devicePixelRatio);
  // The tree's own rows, dragged out and back, are no file manager's:
  // told as the drag comes in, before its drop ends the drag out.
  let own = false;
  const filesOf = (paths: string[]) =>
    Promise.all(
      paths.filter(Boolean).map(async (path) => ({
        path,
        isDir: await isFolder(path),
        fromSystem: !own,
      })),
    );
  const shift = () =>
    windowIpc.dragModifiers().then(
      (m) => !!m?.shift,
      () => false,
    );
  const show = () => {
    if (frame) return;
    const asked = drag;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void Promise.all([files, shift()]).then(([now, held]) => {
        if (asked === drag) to.over(now, at, held);
      });
    });
  };
  const listeners = [
    listenToThisWebview<DragPayload>("tauri://drag-enter", (e) => {
      drag++;
      own = isDraggingOut();
      files = filesOf(e.payload.paths ?? []);
      at = point(e.payload.position);
      show();
    }),
    listenToThisWebview<DragPayload>("tauri://drag-over", (e) => {
      at = point(e.payload.position);
      show();
    }),
    listenToThisWebview<DragPayload>("tauri://drag-leave", () => {
      drag++;
      to.leave();
    }),
    listenToThisWebview<DragPayload>("tauri://drag-drop", (e) => {
      drag++;
      const dropped = filesOf(e.payload.paths ?? []);
      const where = point(e.payload.position);
      void Promise.all([dropped, shift()]).then(([now, held]) =>
        to.drop(now, where, held),
      );
    }),
  ];
  return () => {
    cancelAnimationFrame(frame);
    unlistenAll(...listeners)();
  };
}
