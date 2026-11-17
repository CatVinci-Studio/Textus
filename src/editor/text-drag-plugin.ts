import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { closeHistory } from "@milkdown/kit/prose/history";
import { trackDrag } from "../engine/drag/pointer-drag";
import { isMacPlatform } from "../platform/os";
import "./text-drag.css";
import { edgeScroll } from "../engine/drag/edge-scroll";
import { inLayout } from "../engine/zoom/zoomed-rects";

/**
 * Selected text pressed and pulled moves where it is let go, as in a word
 * processor; with Option (Ctrl elsewhere) held at the drop, a copy goes
 * there instead. By pointer events: the window's own file drop takes the
 * browser's drag and drop. A mouse only - a finger's press selects.
 */
export function movedText(
  state: EditorState,
  from: number,
  to: number,
  at: number,
  copy: boolean,
): Transaction | null {
  if (!copy && at >= from && at <= to) return null;
  const slice = state.doc.slice(from, to);
  const tr = closeHistory(state.tr).replaceRange(at, at, slice);
  if (!copy) tr.deleteRange(tr.mapping.map(from), tr.mapping.map(to));
  // What was put in is selected where it landed.
  const start = tr.mapping.map(at, -1);
  const end = tr.mapping.map(at, 1);
  return tr
    .setSelection(
      TextSelection.between(tr.doc.resolve(start), tr.doc.resolve(end)),
    )
    .scrollIntoView();
}

function pressed(view: EditorView, e: MouseEvent): boolean {
  const { from, to, empty } = view.state.selection;
  if (empty || e.button !== 0 || e.shiftKey || e.metaKey) return false;
  const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (!at || at.pos < from || at.pos > to) return false;
  // On the selected text itself, not past a line's end beside it.
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  if (!hit || !view.dom.contains(hit)) return false;
  e.preventDefault();
  const root = view.dom.parentElement as HTMLElement;
  const caret = document.createElement("div");
  caret.className = "text-drop-caret";
  caret.setAttribute("aria-hidden", "true");
  let landing: number | null = null;
  let moved = false;
  const place = (x: number, y: number) => {
    const pos = view.posAtCoords({ left: x, top: y })?.pos ?? null;
    landing = pos;
    caret.hidden = pos === null || (pos >= from && pos <= to);
    if (caret.hidden || pos === null) return;
    const c = view.coordsAtPos(pos);
    const at = inLayout(root, c.left, c.top);
    caret.style.transform = `translate(${at.x}px, ${at.y}px)`;
    caret.style.height = `${(c.bottom - c.top) / at.zoom}px`;
  };
  // Near the document's top or bottom it scrolls on, the caret following.
  let last = { x: e.clientX, y: e.clientY };
  const edge = edgeScroll(
    () => view.dom.closest<HTMLElement>(".editor-scroll"),
    () => place(last.x, last.y),
  );
  trackDrag(e, {
    start: (x, y) => {
      moved = true;
      root.append(caret);
      place(x, y);
    },
    move: (x, y) => {
      last = { x, y };
      place(x, y);
      edge.at(y);
    },
    end: (_x, _y, dropped, up) => {
      edge.stop();
      caret.remove();
      if (!dropped || landing === null) return;
      const copy = !!up && (isMacPlatform() ? up.altKey : up.ctrlKey);
      const tr = movedText(view.state, from, to, landing, copy);
      if (tr) view.dispatch(tr);
      view.focus();
    },
  });
  // Pressed and let go without a pull: a click, the caret where it was.
  window.addEventListener(
    "pointerup",
    (up) => {
      if (moved) return;
      const pos = view.posAtCoords({ left: up.clientX, top: up.clientY });
      if (pos)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, pos.pos),
          ),
        );
      view.focus();
    },
    { once: true },
  );
  return true;
}

// Whether the press now is a mouse's: a finger's comes as a mouse press too.
let byMouse = false;

export const textDragPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("text-drag"),
      props: {
        handleDOMEvents: {
          pointerdown: (_view, e) => {
            byMouse = (e as PointerEvent).pointerType === "mouse";
            return false;
          },
          mousedown: (view, e) => view.editable && byMouse && pressed(view, e),
          // The browser's own drag of the selection lands nowhere here.
          dragstart: (view, e) => {
            if (view.state.selection.empty) return false;
            e.preventDefault();
            return true;
          },
        },
      },
    }),
);
