import type { EditorView } from "@milkdown/kit/prose/view";
import { motionAllowed } from "../../ui/motion";
import { crossfade } from "../../ui/moves";

/** Animates a decided proposal leaving the text in one move. `callIds` null
 *  means every proposal; `change` returns false when nothing changed. */
export function settle(
  view: EditorView,
  callIds: string[] | null,
  change: () => boolean | void,
): void {
  // Where nothing moves, nothing is looked for either.
  if (!motionAllowed()) {
    change();
    return;
  }
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
