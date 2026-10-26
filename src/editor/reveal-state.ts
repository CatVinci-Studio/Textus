import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  TextSelection,
  type EditorState,
  type Selection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import {
  changedRanges,
  drawnFor,
  redrawBlocks,
  touchedBlocks,
} from "./changed-ranges";
import { cursorTouches } from "./marks/enclosure";

/**
 * Plugin state for the "render it, reveal the source under the caret"
 * plugins. What they draw depends on the selection only through
 * cursorTouches, so the set is stored with every range that was asked about.
 */
export interface RevealState {
  set: DecorationSet;
  /** Each range a drawing asked cursorTouches about, so the ones near a caret
   *  are found without a look at the others. */
  touched: DecorationSet;
  /** Reveal.config when this was drawn. */
  config: unknown;
}

export type Touches = (from: number, to: number) => boolean;

/** How a reveal plugin draws: node by node. */
export interface Reveal {
  /** The nodes drawn one at a time; the walk doesn't go into one. */
  match: (node: ProseNode) => boolean;
  /** What one draws, all inside the node (a widget at its end counts).
   *  `touches` is cursorTouches for the selection, recording each range. */
  decorate: (node: ProseNode, pos: number, touches: Touches) => Decoration[];
  /** What the drawing depends on besides the document and caret (a setting,
   *  the path). When it changes (===), everything is drawn again. */
  config?: () => unknown;
}

// The touched ranges are never drawn; one spec marks them all.
const TOUCHED = { revealTouched: true };

function recorder(selection: Selection) {
  const ranges: Decoration[] = [];
  const touches: Touches = (from, to) => {
    ranges.push(
      from < to
        ? Decoration.inline(from, to, {}, TOUCHED)
        : Decoration.widget(
            from,
            () => document.createElement("span"),
            TOUCHED,
          ),
    );
    return cursorTouches(selection, from, to);
  };
  return { touches, ranges };
}

/** Every node `reveal` matches, drawn. `before` first draws what isn't drawn
 *  node by node. */
export function revealAll(
  state: EditorState,
  reveal: Reveal,
  before?: (touches: Touches, decorations: Decoration[]) => void,
): RevealState {
  const { touches, ranges } = recorder(state.selection);
  const decorations: Decoration[] = [];
  before?.(touches, decorations);
  state.doc.descendants((node, pos) => {
    if (!reveal.match(node)) return true;
    decorations.push(...reveal.decorate(node, pos, touches));
    return false;
  });
  return {
    set: DecorationSet.create(state.doc, decorations),
    touched: DecorationSet.create(state.doc, ranges),
    config: reveal.config?.(),
  };
}

/** Whether [from, to] touches a selection from `a` to `b`. */
const touchesSpan = (a: number, b: number, from: number, to: number) =>
  a <= to && b >= from;

/**
 * `prev` mapped through `tr`, and the top-level blocks it leaves stale: those
 * the transaction changed and those with a range whose cursorTouches the
 * caret's move flipped. Only ranges at the old or new caret can flip.
 */
export function revealChanges(
  tr: Transaction,
  prev: RevealState,
  oldState: EditorState,
  newState: EditorState,
): { mapped: RevealState; blocks: [number, number][] } {
  const mapped = tr.docChanged
    ? {
        set: prev.set.map(tr.mapping, tr.doc),
        touched: prev.touched.map(tr.mapping, tr.doc),
        config: prev.config,
      }
    : prev;
  const ranges: [number, number][] = tr.docChanged ? changedRanges(tr) : [];
  const before = oldState.selection;
  const a = tr.mapping.map(before.from, -1);
  const b = tr.mapping.map(before.to, 1);
  const { from, to } = newState.selection;
  for (const range of [
    ...mapped.touched.find(a, b),
    ...mapped.touched.find(from, to),
  ])
    if (
      touchesSpan(a, b, range.from, range.to) !==
      touchesSpan(from, to, range.from, range.to)
    )
      ranges.push([range.from, range.to]);
  return { mapped, blocks: touchedBlocks(newState.doc, ranges) };
}

/** `mapped` (revealChanges) with `blocks` drawn again. */
export function redrawReveal(
  mapped: RevealState,
  state: EditorState,
  blocks: [number, number][],
  reveal: Reveal,
): RevealState {
  if (blocks.length === 0) return mapped;
  const { touches, ranges } = recorder(state.selection);
  const set = redrawBlocks(
    mapped.set,
    state.doc,
    blocks,
    reveal.match,
    (n, p) => reveal.decorate(n, p, touches),
  );
  const stale: Decoration[] = [];
  for (const [from, to] of blocks)
    for (const range of mapped.touched.find(from, to))
      if (drawnFor(range, from, to)) stale.push(range);
  return {
    set,
    touched: mapped.touched.remove(stale).add(state.doc, ranges),
    config: mapped.config,
  };
}

/**
 * The shared state.apply: an edit redraws only the blocks it changed, a
 * caret move only where it flips a recorded range, instead of walking the
 * whole document on every transaction.
 */
export function applyReveal(
  tr: Transaction,
  prev: RevealState,
  oldState: EditorState,
  newState: EditorState,
  reveal: Reveal,
): RevealState {
  if (reveal.config && reveal.config() !== prev.config)
    return revealAll(newState, reveal);
  if (!tr.docChanged && !tr.selectionSet) return prev;
  const { mapped, blocks } = revealChanges(tr, prev, oldState, newState);
  return redrawReveal(mapped, newState, blocks, reveal);
}

/** A click on a rendered widget puts the caret in the source it stands for,
 *  right before it. `skip` leaves a click to the widget itself. */
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
