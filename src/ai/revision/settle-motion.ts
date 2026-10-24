import type { EditorView } from "@milkdown/kit/prose/view";
import { crossfade } from "../../ui/moves";

/**
 * A proposal decided - accepted, rejected, or all of them at once - leaving
 * the text as one move (ui/moves.ts's crossfade): the blocks it was drawn
 * in cross-fade to how they now read, the text after them glides to where
 * the change put it, and its cards in the margin fade out where they stood.
 * Decided at once, the text jumped and the cards were gone between two
 * frames. `callIds` null: every proposal. `change` makes the decision and
 * says whether the document changed: false, and nothing moves.
 */
export function settle(
  view: EditorView,
  callIds: string[] | null,
  change: () => boolean | void,
): void {
  const root = view.dom as HTMLElement;
  const ofCall =
    callIds === null
      ? "[data-call]"
      : callIds.map((id) => `[data-call="${CSS.escape(id)}"]`).join(", ");
  if (!ofCall) {
    change();
    return;
  }
  const kids = [...root.children];
  const indices = new Set<number>();
  for (const el of root.querySelectorAll(ofCall)) {
    const i = kids.indexOf(blockOf(root, el) as Element);
    if (i >= 0) indices.add(i);
  }
  const sorted = [...indices].sort((a, b) => a - b);
  const touched: [Element, Element] | null = sorted.length
    ? [kids[sorted[0]], kids[sorted[sorted.length - 1]]]
    : null;
  const cards = [
    ...document.querySelectorAll<HTMLElement>(
      `.review-margin > :is(${ofCall})`,
    ),
  ];
  crossfade(root, touched, change, cards);
}

/** The block of the document `el` is in: its ancestor that is one of
 *  `root`'s own children. */
function blockOf(root: HTMLElement, el: Element): Element | null {
  let block: Element | null = el;
  while (block && block.parentElement !== root) block = block.parentElement;
  return block;
}
