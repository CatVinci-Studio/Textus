import {
  fileRooms,
  type DocumentDrop,
  type DraggedFile,
  type FileDropTarget,
  type FileRoom,
} from "../../engine/controls/document-drop";
import {
  barDropAt,
  dropGeometry,
  dropTargetAt,
  type DropGeometry,
  type DropTarget,
} from "../../engine/layout/drop-zones";
import { shownIsland } from "../../engine/layout/store";
import { fs } from "../../platform/ipc";
import { basename } from "../../utils/path";
import { isDocumentName } from "../../files/document-name";
import { dropClaimed } from "../../plugins/contributions/drop-handlers";
import { arrivalPreview } from "../islands/split-drop";
import {
  fileAction,
  fileKindOf,
  type DropPlace,
  type FileAction,
  type FileKind,
} from "./drop-route";
import { droppedMarkdown } from "./dropped-markdown";

type Size = { width: number; height: number };

export interface FileDropWiring {
  /** Opens `path` where it was let go; `first`: the first of the drop. */
  open(
    path: string,
    target: DropTarget,
    first: boolean,
    fromSystem: boolean,
  ): void;
  openFolder(path: string): void;
  /** Where the folder's links resolve; null with no folder open. */
  linkRoot(): string | null;
  hints(): { image: string; link: string };
  failed(path: string, err: unknown): void;
}

/** One file of a drop, and what it does there. */
interface Planned {
  file: DraggedFile;
  kind: FileKind;
  action: FileAction;
}

/** Where (x, y) is: a tab row (opens in that island), a document's edge
 *  (split) or its body; null off the documents. */
function placeAt(
  x: number,
  y: number,
  geometry: DropGeometry,
): { place: DropPlace; target: DropTarget } | null {
  const bar = barDropAt(x, y, "", geometry);
  const front = bar && shownIsland(bar.pane)?.front;
  if (bar && front)
    return {
      place: "bar",
      target: { zone: "center", tabId: front, rect: bar.rect },
    };
  const target = dropTargetAt(x, y, geometry);
  if (!target) return null;
  return { place: target.zone === "center" ? "body" : "edge", target };
}

/**
 * Files dragged over the documents, from the sidebar or a file manager:
 * by where the pointer is and what each file is (drop-route.ts), room
 * opens between a document's blocks for what goes in (file-rooms.ts), or
 * the islands make room where it opens (arrivalPreview).
 */
export function fileDropOnDocuments(wiring: FileDropWiring): DocumentDrop {
  const arrival = arrivalPreview();
  let geometry: DropGeometry | null = null;
  /** Pictures' sizes, read from their files once a drag; null: unknown. */
  const sizes = new Map<string, Size | null>();
  let last: {
    files: readonly DraggedFile[];
    x: number;
    y: number;
    shift: boolean;
  } | null = null;

  const plan = (
    files: readonly DraggedFile[],
    x: number,
    y: number,
    shift: boolean,
  ) => {
    geometry ??= dropGeometry();
    const at = placeAt(x, y, geometry);
    if (!at) return null;
    const doc: FileDropTarget | null =
      at.place === "body"
        ? (fileRooms()?.targetIn(at.target.tabId) ?? null)
        : null;
    const planned: Planned[] = files.map((file) => {
      const kind = fileKindOf(file.path, file.isDir, (p) =>
        isDocumentName(basename(p)),
      );
      const claimed =
        kind !== "folder" && dropClaimed(basename(file.path), kind);
      // A link is written from the document's own place; a picture from a
      // file manager is kept with a draft's until it is saved.
      const canInsert =
        !!doc &&
        (claimed || !!doc.docPath || (!!file.fromSystem && kind === "image"));
      const action = fileAction(kind, {
        place: at.place,
        shift,
        canInsert,
        claimed,
      });
      return { file, kind, action };
    });
    return { ...at, planned };
  };

  const sizeOf = (path: string): Size | null => {
    if (!sizes.has(path)) {
      sizes.set(path, null);
      void fs
        .pictureSize(path)
        .then((size) => {
          if (!size || !sizes.has(path)) return;
          sizes.set(path, size);
          // The room takes the picture's shape as soon as it is known.
          if (last) drop.over(last.files, last.x, last.y, last.shift);
        })
        .catch(() => {});
    }
    return sizes.get(path) ?? null;
  };

  const roomFor = ({ file, kind }: Planned): FileRoom => {
    const hints = wiring.hints();
    return kind === "image"
      ? { kind: "image", size: sizeOf(file.path), hint: hints.image }
      : { kind: "link", hint: hints.link };
  };

  const reset = () => {
    geometry = null;
    last = null;
    sizes.clear();
  };

  const drop: DocumentDrop = {
    over(files, x, y, shift) {
      last = { files, x, y, shift };
      const now = plan(files, x, y, shift);
      if (!now) {
        fileRooms()?.clear();
        arrival.clear();
        return false;
      }
      const going = now.planned.filter((p) => p.action === "insert");
      if (going.length) {
        // Its island shown as it is, not making room for a tab.
        arrival.clear();
        const tab = now.target.tabId;
        if (fileRooms()?.show(tab, x, y, going.map(roomFor))) return true;
      }
      fileRooms()?.clear();
      // A folder alone opens in the sidebar: no room for it here.
      if (now.planned.some((p) => p.action === "open"))
        arrival.show(x, y, now.target);
      else arrival.clear();
      return true;
    },
    leave() {
      fileRooms()?.clear();
      arrival.clear();
      reset();
    },
    drop(files, x, y, shift) {
      const now = plan(files, x, y, shift);
      reset();
      if (!now) {
        fileRooms()?.clear();
        arrival.clear();
        return false;
      }
      const of = (action: FileAction) =>
        now.planned.filter((p) => p.action === action);
      const going = of("insert");
      const root = wiring.linkRoot();
      const filled =
        going.length > 0 &&
        !!fileRooms()?.fill(async (target) => {
          // In order, one after another: a name asked for, or a copy
          // numbered, is the next file's to see.
          const markdown: string[] = [];
          for (const { file, kind } of going) {
            const fromSystem = !!file.fromSystem;
            const md = await droppedMarkdown(
              { path: file.path, kind, fromSystem },
              target,
              root,
            ).catch((err: unknown) => {
              wiring.failed(file.path, err);
              return null;
            });
            if (md) markdown.push(md);
          }
          return markdown;
        });
      if (!filled) fileRooms()?.clear();
      // Rooms that couldn't take them (gone meanwhile): opened instead.
      const opening = filled ? of("open") : [...going, ...of("open")];
      const target = opening.length
        ? (arrival.take(x, y, now.target) ?? now.target)
        : (arrival.clear(), now.target);
      opening.forEach(({ file }, i) =>
        wiring.open(file.path, target, i === 0, !!file.fromSystem),
      );
      for (const { file } of of("folder")) wiring.openFolder(file.path);
      return true;
    },
  };
  return drop;
}
