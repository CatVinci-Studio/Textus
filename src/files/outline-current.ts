import { tabElement } from "../engine/layout/tab-element";
import { HEADING_PLACEHOLDER } from "../editor/lazy/lazy-block-views";
import { noteJump } from "../editor/nav-history";
import { setTabJump } from "../editor/tab-jump";

/** A document's own headings in its editor, drawn or out of sight as
 *  placeholders (the outline's rows are these, in order). */
export const HEADINGS = `:scope > :is(h1, h2, h3, h4, h5, h6, ${HEADING_PLACEHOLDER})`;

/** The index of the section being read in `tabId`'s editor: the last
 *  top-level heading just below the scroller's top, or -1 above the first. */
export function currentHeading(tabId: string): number {
  const scroller = tabElement(tabId)?.querySelector(":scope > .editor-scroll");
  const root = scroller?.querySelector(".editor-content .ProseMirror");
  if (!scroller || !root) return -1;
  const line = scroller.getBoundingClientRect().top + 80;
  const headings = root.querySelectorAll(HEADINGS);
  let current = -1;
  for (let i = 0; i < headings.length; i++) {
    // Folded away in a <details>: no place on screen, not being read.
    if (headings[i].getClientRects().length === 0) continue;
    if (headings[i].getBoundingClientRect().top > line) break;
    current = i;
  }
  return current;
}

/** An outline row's jump to heading `index` of `tabId`, or to its whole
 *  section with `select`; the editor scrolls there as every jump does
 *  (revealPosition), and Back returns. */
export function goToHeading(tabId: string, index: number, select = false) {
  noteJump();
  setTabJump(
    tabId,
    { kind: "outline", index, ...(select && { select }) },
    true,
  );
}
