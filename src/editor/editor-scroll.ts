import { NodeSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { glideScroll } from "../engine/motion/motion";
import { isPhoneLayout } from "../platform/phone-layout";

/**
 * Where the caret's line is kept when the view brings it into sight: below
 * where the page's text starts (clear of the format bar over it), and on a
 * phone above the format bar riding on the keyboard, a line under that bar
 * counting as out of view.
 */
export function scrollOptions(root: HTMLElement) {
  const topRoom = () => {
    const page = root.closest(".editor-content");
    return page ? parseFloat(getComputedStyle(page).paddingTop) || 5 : 5;
  };
  return {
    handleScrollToSelection: (view: EditorView) =>
      !asked(view) || glideToCaret(view, topRoom(), footRoom(root)),
    scrollMargin: {
      get top() {
        return topRoom();
      },
      right: 5,
      get bottom() {
        return footRoom(root);
      },
      left: 5,
    },
    scrollThreshold: {
      top: 0,
      right: 0,
      get bottom() {
        return footRoom(root) - 5;
      },
      left: 0,
    },
  };
}

/** The room the phone's format bar takes at the page's foot. */
function footRoom(root: HTMLElement): number {
  if (!document.documentElement.classList.contains("keyboard-up")) return 5;
  const bar = root
    .closest(".split-pane")
    ?.querySelector<HTMLElement>(":scope > .format-bar");
  return isPhoneLayout() && bar ? bar.offsetHeight + 8 : 5;
}

const scrolled = new WeakMap<EditorView, number>();

/**
 * Whether the view goes to its caret: when an edit asks it to (scrollIntoView), not
 * when the editor merely takes the focus: ProseMirror, finding the caret
 * the browser left at the document's start as focus came, puts its own back
 * and scrolls to it - away from where the page was being read.
 */
function asked(view: EditorView): boolean {
  // Counted by the state: one more for each transaction that asked.
  const count =
    (view.state as { scrollToSelection?: number }).scrollToSelection ?? 0;
  if (count === (scrolled.get(view) ?? 0)) return false;
  scrolled.set(view, count);
  return true;
}

/** Where the selection is drawn: its head, or a selected node's box. */
function selectionBox(view: EditorView): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const { selection } = view.state;
  const node =
    selection instanceof NodeSelection ? view.nodeDOM(selection.from) : null;
  return node instanceof HTMLElement
    ? node.getBoundingClientRect()
    : view.coordsAtPos(selection.head);
}

/** Scrolls whatever scrolls sideways around `pos` (a wide table) so `at`
 *  is in sight, at once: only the page glides. */
export function revealSideways(
  view: EditorView,
  pos: number,
  at: { left: number; right: number } = view.coordsAtPos(pos),
) {
  const scroller = view.dom.closest(".editor-scroll");
  for (
    let el = view.domAtPos(pos).node.parentElement;
    el && el !== scroller;
    el = el.parentElement
  ) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const box = el.getBoundingClientRect();
    if (at.left < box.left + 5) el.scrollLeft -= box.left + 5 - at.left;
    else if (at.right > box.left + el.clientWidth - 5)
      el.scrollLeft += at.right - (box.left + el.clientWidth - 5);
  }
}

/**
 * Brings the caret into sight as ProseMirror would - sideways at once in
 * a wide table, the page in one short glide that a wheel or a press stops.
 * False where the page isn't the app's scroller: ProseMirror does it.
 */
function glideToCaret(view: EditorView, top: number, foot: number): boolean {
  const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
  if (!scroller) return false;
  revealSideways(view, view.state.selection.head, selectionBox(view));
  const at = selectionBox(view);
  const box = scroller.getBoundingClientRect();
  const bottom = box.top + scroller.clientHeight;
  if (at.top < box.top)
    glideScroll(scroller, at.top - (box.top + top), "--dur-fast");
  else if (at.bottom > bottom - (foot - 5))
    glideScroll(scroller, at.bottom - (bottom - foot), "--dur-fast");
  return true;
}
