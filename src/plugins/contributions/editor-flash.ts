import type { EditorView } from "@milkdown/kit/prose/view";
import { flatten, posOf } from "./editor-text";

// Flash (Vim's s): where what was typed is on screen, and the labels a jump takes.

/** A label: drawn after its match (`pos`), jumping to its start (`at`). */
export interface FlashLabel {
  pos: number;
  at: number;
  label: string;
}

const LABELS = "asdfghjklqwertyuiopzxcvbnm";

/** The places `query` is on screen (any case), and once two characters are
 *  typed their labels: nearest the caret first, never a letter that could
 *  continue a match, so typing on narrows the search. */
export function findFlash(view: EditorView, query: string) {
  const { flat, found } = flashMatches(view, query);
  const hay = flat.text.toLowerCase();
  const n = query.length;
  const after = new Set(found.map((at) => hay[at + n]));
  const letters = [...LABELS].filter((l) => !after.has(l));
  const head = view.state.selection.head;
  const near = [...found].sort(
    (a, b) => Math.abs(posOf(flat, a) - head) - Math.abs(posOf(flat, b) - head),
  );
  const matches = found.map((at) => ({
    from: posOf(flat, at),
    to: posOf(flat, at + n - 1) + 1,
  }));
  // One character lights the places; the labels wait for the second.
  const labels: FlashLabel[] =
    n < 2
      ? []
      : near.slice(0, letters.length).map((at, k) => ({
          pos: posOf(flat, at + n - 1) + 1,
          at: posOf(flat, at),
          label: letters[k],
        }));
  return { matches, labels, count: n < 2 ? found.length : labels.length };
}

/** Where `query` is (in any case) in what can be seen of the document:
 *  indices into the text shown. */
function flashMatches(view: EditorView, query: string) {
  const { state } = view;
  const shown = visibleRect(view);
  const top = view.posAtCoords({ left: shown.left + 4, top: shown.top + 2 });
  const bottom = view.posAtCoords({
    left: shown.right - 4,
    top: shown.bottom - 2,
  });
  const size = state.doc.content.size;
  const from = top ? Math.max(0, top.pos - 200) : 0;
  const to = bottom ? Math.min(size, bottom.pos + 200) : size;
  const flat = flatten(state.doc, Math.min(from, to), Math.max(from, to));
  const hay = flat.text.toLowerCase();
  const needle = query.toLowerCase();
  const found: number[] = [];
  for (
    let i = hay.indexOf(needle);
    needle && i >= 0;
    i = hay.indexOf(needle, i + 1)
  ) {
    // Not under the window bar, not scrolled out of sight.
    const box = view.coordsAtPos(posOf(flat, i), 1);
    if (box.bottom > shown.top && box.top < shown.bottom) found.push(i);
  }
  return { flat, found };
}

/** The part of the editor that can be seen: inside the window and the
 *  pane that scrolls it. */
function visibleRect(view: EditorView) {
  const box = view.dom.getBoundingClientRect();
  let top = Math.max(box.top, 0);
  let bottom = Math.min(box.bottom, window.innerHeight);
  for (let el = view.dom.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const pane = el.getBoundingClientRect();
    top = Math.max(top, pane.top);
    bottom = Math.min(bottom, pane.bottom);
    break;
  }
  return { top, bottom, left: box.left, right: box.right };
}
