import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Decoration, EditorView } from "@milkdown/kit/prose/view";
import { DecorationSet } from "@milkdown/kit/prose/view";
import { cursorTouches } from "./marks/enclosure";

/**
 * Plugin state for the "render it, reveal the source under the caret"
 * plugins (math, Mermaid, raw HTML, GitHub alerts). Their decorations only
 * depend on the selection through cursorTouches, so the set is stored with
 * every range that was asked about - flat [from, to, from, to, ...].
 */
export interface RevealState {
  set: DecorationSet;
  ranges: number[];
}

export type Touches = (from: number, to: number) => boolean;

/** Runs `build` with a cursorTouches that records each range it answers. */
export function buildReveal(
  state: EditorState,
  build: (touches: Touches) => Decoration[],
): RevealState {
  const ranges: number[] = [];
  const touches: Touches = (from, to) => {
    ranges.push(from, to);
    return cursorTouches(state.selection, from, to);
  };
  return { set: DecorationSet.create(state.doc, build(touches)), ranges };
}

export const emptyReveal: RevealState = {
  set: DecorationSet.empty,
  ranges: [],
};

/**
 * The shared state.apply. Rebuilding meant a full-document walk on every
 * transaction, arrow keys and clicks included; a caret move can only change
 * the result if it flips cursorTouches for one of the recorded ranges, so
 * anything else keeps the previous set (positions are unchanged when the
 * doc is).
 */
export function applyReveal(
  tr: Transaction,
  prev: RevealState,
  oldState: EditorState,
  newState: EditorState,
  rebuild: (state: EditorState) => RevealState,
): RevealState {
  if (!tr.docChanged) {
    if (!tr.selectionSet) return prev;
    const before = oldState.selection;
    const after = newState.selection;
    let flipped = false;
    for (let i = 0; i < prev.ranges.length && !flipped; i += 2) {
      const from = prev.ranges[i];
      const to = prev.ranges[i + 1];
      flipped =
        cursorTouches(before, from, to) !== cursorTouches(after, from, to);
    }
    if (!flipped) return prev;
  }
  return rebuild(newState);
}

/** A click on a rendered widget puts the caret in the source it stands for
 *  (the widget sits right after it), which shows that source to edit.
 *  `skip` leaves a click to the widget itself. */
export function caretToSourceOnClick(
  el: HTMLElement,
  view: EditorView,
  getPos: () => number | undefined,
  skip: (event: Event) => boolean = () => false,
): void {
  el.addEventListener("mousedown", (event) => {
    if (skip(event)) return;
    event.preventDefault();
    const widgetPos = getPos();
    if (typeof widgetPos !== "number") return;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, widgetPos - 1),
      ),
    );
    view.focus();
  });
}
