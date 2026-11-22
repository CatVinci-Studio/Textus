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
import { paneOf, shownIsland, windowLayout } from "../../engine/layout/store";
import { setIncomingTab } from "../../engine/controls/tabs/incoming-tab";
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
 *  (split) or its body; null off the documents. `slot`: where in which
 *  row a tab opening there would stand - under the pointer on the row,
 *  at its end from the body - when the island has a row. */
function placeAt(
  x: number,
  y: number,
  geometry: DropGeometry,
): {
  place: DropPlace;
  target: DropTarget;
  slot: { pane: string; x: number } | null;
} | null {
  const bar = barDropAt(x, y, "", geometry);
  const front = bar && shownIsland(bar.pane)?.front;
  if (bar && front)
    return {
      place: "bar",
      target: { zone: "center", tabId: front, rect: bar.rect },
      slot: { pane: bar.pane, x },
    };
  const target = dropTargetAt(x, y, geometry);
  if (!target) return null;
  if (target.zone !== "center") return { place: "edge", target, slot: null };
  const pane = paneOf(windowLayout(), target.tabId);
  const row = geometry.bars.find((b) => b.pane === pane)?.row;
  return {
    place: "body",
    target,
    slot: row && pane ? { pane, x: row.right } : null,
  };
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

  const clearAll = () => {
    fileRooms()?.clear();
    arrival.clear();
    setIncomingTab(null);
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
        clearAll();
        return false;
      }
      const going = now.planned.filter((p) => p.action === "insert");
      if (going.length) {
        // Its island shown as it is, not making room for a tab.
        arrival.clear();
        setIncomingTab(null);
        const tab = now.target.tabId;
        if (fileRooms()?.show(tab, x, y, going.map(roomFor))) return true;
      }
      fileRooms()?.clear();
      const opening = now.planned.find((p) => p.action === "open");
      // Opening in the island: a tab's room in its row, the document
      // still showing; on an edge, the islands make room. A folder alone
      // opens in the sidebar: no room for it here.
      if (opening && now.slot) {
        arrival.clear();
        setIncomingTab({ ...now.slot, title: basename(opening.file.path) });
      } else {
        setIncomingTab(null);
        if (opening) arrival.show(x, y, now.target);
        else arrival.clear();
      }
      return true;
    },
    leave() {
      clearAll();
      reset();
    },
    drop(files, x, y, shift) {
      const now = plan(files, x, y, shift);
      setIncomingTab(null);
      if (!now) {
        reset();
        clearAll();
        return false;
      }
      const of = (action: FileAction) =>
        now.planned.filter((p) => p.action === action);
      const going = of("insert");
      const opening = of("open");
      const where = {
        tabId: now.target.tabId,
        x,
        y,
        rooms: going.map(roomFor),
      };
      reset();
      const target = opening.length
        ? (arrival.take(x, y, now.target) ?? now.target)
        : (arrival.clear(), now.target);
      const open = (planned: Planned[], first: boolean) =>
        planned.forEach(({ file }, i) =>
          wiring.open(file.path, target, first && i === 0, !!file.fromSystem),
        );
      for (const { file } of of("folder")) wiring.openFolder(file.path);
      if (!going.length) {
        open(opening, true);
        return true;
      }
      const root = wiring.linkRoot();
      const produce = async (doc: FileDropTarget) => {
        // In order, one after another: a name asked for, or a copy
        // numbered, is the next file's to see.
        const markdown: string[] = [];
        for (const { file, kind } of going) {
          const fromSystem = !!file.fromSystem;
          const md = await droppedMarkdown(
            { path: file.path, kind, fromSystem },
            doc,
            root,
          ).catch((err: unknown) => {
            wiring.failed(file.path, err);
            return null;
          });
          if (md) markdown.push(md);
        }
        return markdown;
      };
      // What goes in first, while its document is in front; then what
      // opens. The document gone meanwhile: what would have gone in opens.
      void (fileRooms()?.fill(produce, where) ?? Promise.resolve(false)).then(
        (filled) => {
          if (!filled) fileRooms()?.clear();
          open(filled ? opening : [...going, ...opening], true);
        },
      );
      return true;
    },
  };
  return drop;
}
