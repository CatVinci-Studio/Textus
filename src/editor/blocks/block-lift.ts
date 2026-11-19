import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import "./block-lift.css";

/** A block being pulled, as one editor shows it: the block itself, in the
 *  editor it is from (`pos`), and the room it will take where it lands,
 *  in whichever editor that is (`landing`). */
export interface Pulled {
  pos: number | null;
  landing: number | null;
  room: HTMLElement | null;
}

/** The pulled block's place, and the room it will take: the block out of
 *  the page, and the room open where it lands - its own place while it
 *  would stay - the blocks around moved aside. */
export function pulledDecorations(
  doc: ProseNode,
  pulled: Pulled | null,
): DecorationSet | null {
  if (!pulled) return null;
  const decorations: Decoration[] = [];
  const node = pulled.pos === null ? null : doc.nodeAt(pulled.pos);
  if (node && pulled.pos !== null)
    decorations.push(
      Decoration.node(pulled.pos, pulled.pos + node.nodeSize, {
        class: "block-drag-gone",
      }),
    );
  if (pulled.landing !== null && pulled.room)
    decorations.push(
      Decoration.widget(pulled.landing, pulled.room, {
        key: "block-drag-room",
      }),
    );
  return decorations.length ? DecorationSet.create(doc, decorations) : null;
}

/** The room a pulled block takes where it will land: its height, and its
 *  margins, so the blocks around stand as they will; its outline the
 *  lifted copy's own (`lifted`), where the copy would come to rest. */
export function roomFor(source: HTMLElement, lifted: HTMLElement): HTMLElement {
  const room = document.createElement("div");
  room.className = "block-drag-room";
  room.setAttribute("aria-hidden", "true");
  room.contentEditable = "false";
  const style = getComputedStyle(source);
  Object.assign(room.style, {
    height: `${source.offsetHeight}px`,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
  });
  const frame = getComputedStyle(lifted);
  room.style.setProperty("--room-top", frame.marginTop);
  room.style.setProperty("--room-width", `${lifted.offsetWidth}px`);
  // A list item put outside a list lands in a list of its own: its
  // outline stands in that list's indent.
  const left = parseFloat(frame.marginLeft) || 0;
  const indent =
    source.tagName === "LI" && source.parentElement
      ? parseFloat(getComputedStyle(source.parentElement).paddingLeft) || 0
      : 0;
  room.dataset.left = String(left);
  room.dataset.indent = String(indent);
  return room;
}

/** The room's outline where it opens: in a list (`inList`), or outside. */
export function placeRoom(room: HTMLElement, inList: boolean) {
  const left =
    Number(room.dataset.left) + (inList ? 0 : Number(room.dataset.indent));
  room.style.setProperty("--room-left", `${left}px`);
}

/** The blocks that move aside as the room opens and closes: an editor's
 *  own, and list items. */
export function movingBlocks(view: EditorView): Element[] {
  // Only those within a screen of what shows: the rest move out of sight,
  // and measuring every block of a long document stalls each step.
  const children = [...view.dom.children];
  const reach = window.innerHeight;
  const from = firstReaching(children, -reach);
  const to = firstReaching(children, 2 * reach, true);
  const near = children.slice(from, to);
  return [...near, ...near.flatMap((el) => [...el.querySelectorAll("li")])];
}

/** The first of `blocks`, in page order, whose bottom (`top`: top) is
 *  past `y` on screen. */
function firstReaching(blocks: Element[], y: number, top = false): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const box = blocks[mid]!.getBoundingClientRect();
    if ((top ? box.top : box.bottom) < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** What gives a lifted block its look off the page: its list (for its
 *  marker, numbered as it was) and the editor's rules and type. */
export function blockLook(source: HTMLElement, view: EditorView) {
  return (copy: HTMLElement): HTMLElement => {
    copy.classList.remove("ProseMirror-selectednode", "block-drag-gone");
    // As it reads at rest: not what editing it shows (its "##", its caret).
    for (const el of copy.querySelectorAll(".heading-marker, .block-fold"))
      el.remove();
    // What draws it (a task's box, its state) is in its data- attributes,
    // which a lifted copy is cleared of.
    for (const attr of source.attributes)
      if (attr.name.startsWith("data-"))
        copy.setAttribute(attr.name, attr.value);
    let inner = copy;
    const list = source.parentElement;
    if (source.tagName === "LI" && list) {
      const wrap = list.cloneNode(false) as HTMLElement;
      // Numbered by a counter from the list's start: this item's number.
      if (list.tagName === "OL") {
        const before = Number.parseInt(
          getComputedStyle(list).getPropertyValue("--textus-ol-start"),
          10,
        );
        const index = [...list.children].indexOf(source);
        wrap.style.setProperty(
          "--textus-ol-start",
          String((Number.isNaN(before) ? 0 : before) + index),
        );
      }
      wrap.append(copy);
      inner = wrap;
    }
    const milkdown = document.createElement("div");
    milkdown.className = "milkdown";
    const style = getComputedStyle(view.dom);
    Object.assign(milkdown.style, {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      color: style.color,
    });
    milkdown.append(inner);
    const lift = document.createElement("div");
    lift.className = "block-drag-lift";
    // Its marker drawn left of it, taken in: the copy starts where the
    // block shows, not at its margin.
    const reach = source.tagName === "LI" ? markerReach(source) : 0;
    if (reach) {
      lift.style.paddingLeft = `${reach}px`;
      lift.style.marginLeft = `${-reach}px`;
    }
    lift.append(milkdown);
    return lift;
  };
}

/** How far left of a list item its marker is drawn (a bullet or number
 *  out in the list's indent); a task's box is drawn inside the item. */
function markerReach(item: HTMLElement): number {
  const marker = getComputedStyle(item, "::before");
  if (marker.content === "none" || marker.position !== "absolute") return 0;
  const shift =
    marker.transform && marker.transform !== "none"
      ? new DOMMatrix(marker.transform).m41
      : 0;
  const left =
    (parseFloat(getComputedStyle(item).paddingLeft) || 0) +
    (parseFloat(marker.marginLeft) || 0) +
    shift;
  return Math.max(0, Math.round(-left));
}

/** The editors a block can be pulled between: every one open in this
 *  window, and the box (its handles' root) it measures in. */
export const openEditors = new Map<EditorView, HTMLElement>();
