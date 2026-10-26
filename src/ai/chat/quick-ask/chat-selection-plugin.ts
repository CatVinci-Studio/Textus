import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

type ChatSelectionMeta =
  | { type: "set"; from: number; to: number }
  | { type: "clear" }
  | { type: "hot"; hot: boolean };

interface ChatSelectionState {
  range: { from: number; to: number } | null;
  /** The pointer is on the composer's selection chip: drawn stronger, so
   *  the chip and the passage read as one thing. */
  hot: boolean;
}

const chatSelectionKey = new PluginKey<ChatSelectionState>("chat-selection");

/** The highlighted range as it reads now, mapped through every edit since it
 *  was set. */
export function chatSelectionRange(
  state: EditorState,
): { from: number; to: number } | null {
  return chatSelectionKey.getState(state)?.range ?? null;
}

/** Highlight or clear the chat-context selection: Quick Ask's captured range,
 *  or the live selection a chip refers to. */
export function setChatSelection(
  tr: Transaction,
  range: { from: number; to: number } | null,
): Transaction {
  const meta: ChatSelectionMeta = range
    ? { type: "set", from: range.from, to: range.to }
    : { type: "clear" };
  return tr.setMeta(chatSelectionKey, meta);
}

/** Strengthen the highlight while the pointer is on the selection chip,
 *  without touching the range. */
export function setChatSelectionHot(
  tr: Transaction,
  hot: boolean,
): Transaction {
  return tr.setMeta(chatSelectionKey, { type: "hot", hot });
}

const EMPTY: ChatSelectionState = { range: null, hot: false };

function within(state: EditorState, from: number, to: number) {
  return from < to && to <= state.doc.content.size;
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The boxes the range's text takes up on screen, per text fragment, so a
 *  paragraph contributes its lines, not its full-width block; a leaf block
 *  contributes its own box. */
function rangeBoxes(view: EditorView, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  const add = (rects: Iterable<DOMRect>) => {
    for (const r of rects)
      if (r.width > 0.5 && r.height > 0.5)
        boxes.push({
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        });
  };
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      const start = Math.max(from, pos + 1);
      const end = Math.min(to, pos + node.nodeSize - 1);
      if (start >= end) return false;
      try {
        const a = view.domAtPos(start);
        const b = view.domAtPos(end);
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        add(range.getClientRects());
      } catch {
        // A node view that maps no positions (a code editor): its box.
        const dom = view.nodeDOM(pos);
        if (dom instanceof Element) add([dom.getBoundingClientRect()]);
      }
      return false;
    }
    if (node.isBlock && node.isLeaf) {
      const dom = view.nodeDOM(pos);
      if (dom instanceof Element) add([dom.getBoundingClientRect()]);
    }
    return true;
  });
  return boxes;
}

/** The boxes to draw: one per line, bridged to the next line so the passage
 *  reads as one, without stripes. A gap over twice the line height isn't
 *  bridged: something else (Quick Ask's panel) sits there. */
export function highlightBoxes(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const lines: Box[] = [];
  for (const box of sorted) {
    const line = lines[lines.length - 1];
    const middle = (box.top + box.bottom) / 2;
    if (line && middle >= line.top && middle <= line.bottom) {
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
      line.left = Math.min(line.left, box.left);
      line.right = Math.max(line.right, box.right);
    } else {
      lines.push({ ...box });
    }
  }
  const out: Box[] = [];
  lines.forEach((line, i) => {
    out.push(line);
    const next = lines[i + 1];
    if (!next) return;
    const gap = next.top - line.bottom;
    const left = Math.max(line.left, next.left);
    const right = Math.min(line.right, next.right);
    const tallest = Math.max(line.bottom - line.top, next.bottom - next.top);
    if (gap > 0 && gap <= 2 * tallest && right > left)
      out.push({ top: line.bottom, bottom: next.top, left, right });
  });
  return out;
}

/** Product of the CSS `zoom` on `el` and its ancestors: client rects come
 *  back zoomed while the layer's own coordinates don't. */
function effectiveZoom(el: Element | null): number {
  let zoom = 1;
  for (let at = el; at; at = at.parentElement)
    zoom *= parseFloat(getComputedStyle(at).zoom) || 1;
  return zoom;
}

/**
 * Draws the highlight as a layer beside the editor's DOM, a box per line. Not
 * decorations: they striped the passage, and changing them redraws the
 * paragraph, replaying every revision's entrance in it.
 */
class HighlightLayer {
  private readonly layer: HTMLElement;
  private frame = 0;
  private readonly observer: ResizeObserver | null;
  private readonly onScroll = () => this.schedule();

  constructor(private view: EditorView) {
    this.layer = document.createElement("div");
    this.layer.className = "chat-selection-layer";
    this.layer.setAttribute("aria-hidden", "true");
    // After the text: drawn over it, so the backgrounds of table headers
    // and inline code don't hide it.
    view.dom.after(this.layer);
    // Layout moves under a fixed range too: a narrower window, a zoom, the
    // text column opening a margin, an image loading.
    this.observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => this.schedule());
    this.observer?.observe(view.dom);
    window.addEventListener("scroll", this.onScroll, true);
    this.draw();
  }

  update(view: EditorView, prev: EditorState) {
    this.view = view;
    const now = chatSelectionKey.getState(view.state);
    const before = chatSelectionKey.getState(prev);
    if (now === before && view.state.doc === prev.doc) return;
    // Only the chip's hover changed: the same boxes, so the tint eases.
    if (now?.range === before?.range && view.state.doc === prev.doc) {
      this.layer.classList.toggle("is-hot", !!now?.hot);
      return;
    }
    this.draw();
  }

  private schedule() {
    if (this.frame || !chatSelectionKey.getState(this.view.state)?.range)
      return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    const state = chatSelectionKey.getState(this.view.state) ?? EMPTY;
    this.layer.classList.toggle("is-hot", state.hot);
    const { range } = state;
    if (!range || !within(this.view.state, range.from, range.to)) {
      this.layer.replaceChildren();
      return;
    }
    const origin = this.layer.getBoundingClientRect();
    const zoom = effectiveZoom(this.layer);
    const lines = highlightBoxes(rangeBoxes(this.view, range.from, range.to));
    this.layer.replaceChildren(
      ...lines.map((line) => {
        const box = document.createElement("div");
        box.className = "chat-selection";
        box.style.top = `${(line.top - origin.top) / zoom}px`;
        box.style.left = `${(line.left - origin.left) / zoom}px`;
        box.style.width = `${(line.right - line.left) / zoom}px`;
        box.style.height = `${(line.bottom - line.top) / zoom}px`;
        return box;
      }),
    );
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener("scroll", this.onScroll, true);
    this.layer.remove();
  }
}

/**
 * Keeps the passage a chat is about marked while the chat has the focus,
 * since native selection paint vanishes once the composer takes it. Its range
 * is the live one, mapped through every edit, that a send resolves to.
 */
export const chatSelectionPlugin = $prose(
  () =>
    new Plugin<ChatSelectionState>({
      key: chatSelectionKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev, _old, state): ChatSelectionState {
          const meta = tr.getMeta(chatSelectionKey) as
            ChatSelectionMeta | undefined;
          if (meta?.type === "set")
            return within(state, meta.from, meta.to)
              ? { range: { from: meta.from, to: meta.to }, hot: prev.hot }
              : { ...EMPTY, hot: prev.hot };
          if (meta?.type === "clear") return { ...EMPTY, hot: prev.hot };
          if (meta?.type === "hot")
            return meta.hot === prev.hot ? prev : { ...prev, hot: meta.hot };
          if (tr.docChanged && prev.range) {
            // Outward bias at both ends: when the range itself is replaced
            // (an accepted rewrite of the selection), it grows to cover the
            // replacement instead of collapsing to a point.
            const from = tr.mapping.map(prev.range.from, -1);
            const to = tr.mapping.map(prev.range.to, 1);
            if (from >= to) return { ...EMPTY, hot: prev.hot };
            return { range: { from, to }, hot: prev.hot };
          }
          return prev;
        },
      },
      view: (view) => new HighlightLayer(view),
    }),
);
