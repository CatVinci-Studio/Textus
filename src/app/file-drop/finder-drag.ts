import { listenToThisWebview, unlistenAll } from "../../platform/events";
import { windowIpc } from "../../platform/ipc";
import { isWindowsPlatform } from "../../platform/os";
import type { DraggedFile } from "../../engine/controls/document-drop";
import { dropPointInPage } from "../dropped-files";
import { folderName } from "../../utils/path";
import { copyKey, rowsOut } from "../../files/drag-out";

type Point = { x: number; y: number };

/** The keys held over the drag: Shift opens; the copy key (Option, Ctrl
 *  elsewhere) copies the tree's own rows brought back. */
export interface DragHeld {
  shift: boolean;
  copy: boolean;
}

const NONE: DragHeld = { shift: false, copy: false };

/** `rows` when the system's drag carries them (by name: it may name a
 *  folder by where a link leads); else null, as for a drag out whose end
 *  was never heard. */
function sameNames(
  rows: readonly DraggedFile[] | null,
  paths: readonly string[],
): readonly DraggedFile[] | null {
  const names = (all: readonly string[]) =>
    all.map(folderName).sort().join("\n");
  return rows &&
    names(rows.map((row) => row.path)) === names(paths.filter(Boolean))
    ? rows
    : null;
}

/** What the system's drag events carry: the paths on entering and on the
 *  drop, the pointer (physical pixels on Windows) throughout. */
interface DragPayload {
  paths?: string[];
  position: Point;
}

interface SystemDrag {
  over(files: readonly DraggedFile[], at: Point, held: DragHeld): void;
  leave(): void;
  drop(files: readonly DraggedFile[], at: Point, held: DragHeld): void;
}

/**
 * Files dragged over the window from a file manager, through Tauri's drag
 * events: the paths come on entering, which of them are folders soon
 * after. The page hears no keys meanwhile, so the keys are asked of the
 * system (`drag_modifiers`), at most once a frame, and again on the drop. Each
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
  // told as the drag comes in, before its drop ends the drag out, and
  // taken as they went out.
  let own: readonly DraggedFile[] | null = null;
  const filesOf = (paths: string[]): Promise<DraggedFile[]> =>
    own
      ? Promise.resolve(own.map((row) => ({ ...row, fromSystem: false })))
      : Promise.all(
          paths.filter(Boolean).map(async (path) => ({
            path,
            isDir: await isFolder(path),
            fromSystem: true,
          })),
        );
  const keys = () =>
    windowIpc.dragModifiers().then(
      (m): DragHeld =>
        m
          ? { shift: m.shift, copy: copyKey() === "Alt" ? m.alt : m.ctrl }
          : NONE,
      () => NONE,
    );
  const show = () => {
    if (frame) return;
    const asked = drag;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void Promise.all([files, keys()]).then(([now, held]) => {
        if (asked === drag) to.over(now, at, held);
      });
    });
  };
  const listeners = [
    listenToThisWebview<DragPayload>("tauri://drag-enter", (e) => {
      drag++;
      own = sameNames(rowsOut(), e.payload.paths ?? []);
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
      void Promise.all([dropped, keys()]).then(([now, held]) =>
        to.drop(now, where, held),
      );
    }),
  ];
  return () => {
    cancelAnimationFrame(frame);
    unlistenAll(...listeners)();
  };
}
