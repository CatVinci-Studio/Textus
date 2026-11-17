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
  /** The block would land where it is: its place stays, outlined. */
  staying: boolean;
  landing: number | null;
  room: HTMLElement | null;
}

/** The pulled block's place, and the room it will take: its own place a
 *  dashed outline while it would stay; else gone, and the room open where
 *  it lands, the blocks around moved aside. */
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
        class: pulled.staying ? "block-drag-slot" : "block-drag-gone",
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
 *  margins, so the blocks around stand as they will. */
export function roomFor(source: HTMLElement): HTMLElement {
  const room = document.createElement("div");
  room.className = "block-drag-slot block-drag-room";
  room.setAttribute("aria-hidden", "true");
  room.contentEditable = "false";
  const style = getComputedStyle(source);
  Object.assign(room.style, {
    height: `${source.offsetHeight}px`,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
  });
  return room;
}

/** The blocks that move aside as the room opens and closes: an editor's
 *  own, and list items. */
export const movingBlocks = (view: EditorView): Element[] => [
  ...view.dom.children,
  ...view.dom.querySelectorAll("li"),
];

/** What gives a lifted block its look off the page: its list (for its
 *  marker, numbered as it was) and the editor's rules and type. */
export function blockLook(source: HTMLElement, view: EditorView) {
  return (copy: HTMLElement): HTMLElement => {
    copy.classList.remove("ProseMirror-selectednode", "block-drag-slot");
    let inner = copy;
    const list = source.parentElement;
    if (source.tagName === "LI" && list) {
      const wrap = list.cloneNode(false) as HTMLElement;
      if (list.tagName === "OL") {
        const first = Number(list.getAttribute("start") ?? 1);
        const index = [...list.children].indexOf(source);
        wrap.setAttribute("start", String(first + index));
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
    lift.append(milkdown);
    return lift;
  };
}

/** The editors a block can be pulled between: every one open in this
 *  window, and the box (its handles' root) it measures in. */
export const openEditors = new Map<EditorView, HTMLElement>();
