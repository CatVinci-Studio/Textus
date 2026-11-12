import type { EditorView } from "@milkdown/kit/prose/view";

/** The editor focused from a control outside it (a card's Apply) with the
 *  page left where the reader has it: WebKit, taking the focus back, first
 *  puts back its own selection from before and scrolls to that, however
 *  far it is. */
export function focusInPlace(view: EditorView): void {
  const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
  const top = scroller?.scrollTop;
  view.focus();
  if (!scroller || top === undefined) return;
  const hold = () => {
    if (scroller.scrollTop !== top) scroller.scrollTop = top;
  };
  hold();
  requestAnimationFrame(hold);
}
