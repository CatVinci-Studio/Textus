import type { EditorView } from "@milkdown/kit/prose/view";
import {
  setFileRooms,
  type FileRoom,
  type FileRooms,
} from "../../engine/controls/document-drop";
import { flip } from "../../engine/motion/flip";
import { inLayout } from "../../engine/zoom/zoomed-rects";
import { openEditors, movingBlocks } from "../blocks/block-lift";
import { boxIn, nearestGap, withRoom } from "../blocks/block-handle-place";
import { showPulled } from "../blocks/block-handles-plugin";
import { dropEditors, fillRooms, targetOf } from "./file-drop-insert";
import "./file-rooms.css";

/*
 * Files dragged over a document (from the sidebar or a file manager) open
 * room between its blocks, as a pulled block does (block-drag.ts): each
 * file a room the size of what it will be, the blocks around moving
 * aside; let go, what they become goes in there.
 */

/** Where room is open: the editor, the place between its blocks, and the
 *  rooms as made for these files. */
interface Open {
  view: EditorView;
  landing: number;
  room: HTMLElement;
  key: string;
}

/** The places between an editor's top-level blocks, measured as the drag
 *  found them: read live, the room opening moved them under the pointer. */
function placesIn(view: EditorView, root: HTMLElement) {
  const { doc } = view.state;
  const blocks: { pos: number; el: HTMLElement | null }[] = [];
  doc.forEach((_node, pos) => {
    const el = view.nodeDOM(pos);
    // Folded away, or not drawn: nothing to stand by.
    const shown = el instanceof HTMLElement && el.offsetParent ? el : null;
    blocks.push({ pos, el: shown });
  });
  const left = boxIn(root, view.dom).x;
  const places: { pos: number; y: number; left: number }[] = [];
  for (let i = 0; i <= blocks.length; i++) {
    const prev = blocks[i - 1]?.el;
    const next = blocks[i]?.el;
    const above = prev ? boxIn(root, prev).y + prev.offsetHeight : null;
    const below = next ? boxIn(root, next).y : null;
    const y =
      above !== null && below !== null
        ? (above + below) / 2
        : (below ?? above ?? 0);
    places.push({ pos: blocks[i]?.pos ?? doc.content.size, y, left });
  }
  return places;
}

/** The rooms for `rooms`, in order, in one widget: several files go in
 *  one after another at one place. */
function roomsElement(rooms: readonly FileRoom[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "file-drop-rooms";
  wrap.setAttribute("aria-hidden", "true");
  wrap.contentEditable = "false";
  for (const spec of rooms) {
    const room = document.createElement("div");
    room.className = `block-drag-room file-drop-room file-drop-room-${spec.kind}`;
    if (spec.kind === "image" && spec.size) {
      // As the picture will be drawn: its own width at most, its shape.
      room.style.setProperty("--file-room-width", `${spec.size.width}px`);
      room.style.setProperty(
        "--file-room-ratio",
        `${spec.size.width} / ${spec.size.height}`,
      );
    } else if (spec.kind === "image")
      room.classList.add("file-drop-room-unsized");
    const hint = document.createElement("span");
    hint.className = "file-drop-hint";
    hint.textContent = spec.hint;
    room.append(hint);
    wrap.append(room);
  }
  return wrap;
}

let open: Open | null = null;
const layouts = new Map<EditorView, ReturnType<typeof placesIn>>();

/** The editable editor of tab `tabId`: found by its tab, not by what is
 *  under the pointer, which the islands making room may have covered. */
function editorOf(tabId: string): EditorView | null {
  for (const view of dropEditors.keys())
    if (
      view.editable &&
      openEditors.has(view) &&
      view.dom.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId === tabId
    )
      return view;
  return null;
}

/** What each editor shows: the rooms in `next`, gone from where they
 *  were, the blocks around gliding aside. */
function showOpen(next: Open | null) {
  const was = open;
  if (
    was?.view === next?.view &&
    was?.landing === next?.landing &&
    was?.room === next?.room
  )
    return;
  const views = new Set([was?.view, next?.view].filter((v) => !!v));
  flip([...views].flatMap(movingBlocks), () => {
    if (was && was.view !== next?.view && !was.view.isDestroyed)
      showPulled(was.view, null);
    if (next)
      showPulled(next.view, {
        pos: null,
        landing: next.landing,
        room: next.room,
      });
  });
  open = next;
}

const rooms: FileRooms = {
  targetIn(tabId) {
    const view = editorOf(tabId);
    return view && targetOf(view);
  },
  show(tabId, x, y, specs) {
    const view = editorOf(tabId);
    const root = view && openEditors.get(view);
    if (!view || !root) {
      rooms.clear();
      return false;
    }
    // Not laid out yet (the islands giving back the room they made): the
    // places are measured on the next move.
    if (!view.dom.offsetParent) return true;
    const key = JSON.stringify(specs);
    const room =
      open?.view === view && open.key === key ? open.room : roomsElement(specs);
    let places = layouts.get(view);
    if (!places) {
      places = placesIn(view, root);
      layouts.set(view, places);
    }
    // As the places stand with the room open where it is now.
    const tall = open?.view === view ? open.room.offsetHeight : 0;
    const at = inLayout(root, x, y);
    const gap = nearestGap(
      withRoom(places, open?.view === view ? open.landing : null, tall),
      at.x,
      at.y,
    );
    if (!gap) return false;
    showOpen({ view, landing: gap.pos, room, key });
    return true;
  },
  clear() {
    showOpen(null);
    layouts.clear();
  },
  fill(produce) {
    const was = open;
    if (!was) return false;
    // The rooms stay as the place holder while the files are copied.
    open = null;
    layouts.clear();
    void fillRooms(was.view, produce);
    return true;
  },
};

/** The editors take file drops once one is open. */
export function takeFileDrops(): void {
  setFileRooms(rooms);
}
